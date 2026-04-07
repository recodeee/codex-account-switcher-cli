import type {
  AuthIdentityDTO,
  IAuthModuleService,
  ICustomerModuleService,
  IUserModuleService,
  MedusaContainer,
  UserDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

type LinkStats = {
  scannedAdminAuthIdentities: number
  alreadyLinked: number
  fixedBrokenCustomerRefs: number
  usedExistingCustomers: number
  convertedGuestCustomers: number
  createdCustomers: number
  linkedAuthIdentities: number
  skippedMissingUser: number
  skippedMissingEmail: number
  errors: number
}

const DEFAULT_BATCH_SIZE = 200

const parseBoolEnv = (value?: string) =>
  value === "1" || value?.toLowerCase() === "true"

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || ""

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const toStringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

const selectAdminAuthIdentities = (authIdentities: AuthIdentityDTO[]) =>
  authIdentities.filter((authIdentity) => {
    const metadata = authIdentity.app_metadata
    if (!isRecord(metadata)) {
      return false
    }

    return !!toStringValue(metadata.user_id)
  })

const findPreferredCustomerByEmail = async (
  customerModuleService: ICustomerModuleService,
  email: string
) => {
  const existing = await customerModuleService.listCustomers({ email })
  if (!existing.length) {
    return undefined
  }

  return existing.find((customer) => customer.has_account) ?? existing[0]
}

const fetchUsersById = async (
  userModuleService: IUserModuleService,
  batchSize: number
) => {
  const usersById = new Map<string, UserDTO>()
  let skip = 0

  while (true) {
    const users = await userModuleService.listUsers({}, { take: batchSize, skip })
    if (!users.length) {
      break
    }

    for (const user of users) {
      usersById.set(user.id, user)
    }

    if (users.length < batchSize) {
      break
    }

    skip += batchSize
  }

  return usersById
}

const fetchAdminAuthIdentities = async (
  authModuleService: IAuthModuleService,
  batchSize: number
) => {
  const adminAuthIdentities: AuthIdentityDTO[] = []
  let skip = 0

  while (true) {
    const authIdentities = await authModuleService.listAuthIdentities({}, { take: batchSize, skip })
    if (!authIdentities.length) {
      break
    }

    adminAuthIdentities.push(...selectAdminAuthIdentities(authIdentities))

    if (authIdentities.length < batchSize) {
      break
    }

    skip += batchSize
  }

  return adminAuthIdentities
}

export default async function linkAdminUsersToCustomers({
  container,
}: {
  container: MedusaContainer
}) {
  const dryRun = parseBoolEnv(process.env.DRY_RUN)
  const parsedBatchSize = Number.parseInt(process.env.ADMIN_CUSTOMER_LINK_BATCH_SIZE || "", 10)
  const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
    ? parsedBatchSize
    : DEFAULT_BATCH_SIZE

  const authModuleService = container.resolve<IAuthModuleService>(Modules.AUTH)
  const customerModuleService = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)
  const userModuleService = container.resolve<IUserModuleService>(Modules.USER)

  const usersById = await fetchUsersById(userModuleService, batchSize)
  const adminAuthIdentities = await fetchAdminAuthIdentities(authModuleService, batchSize)

  const stats: LinkStats = {
    scannedAdminAuthIdentities: adminAuthIdentities.length,
    alreadyLinked: 0,
    fixedBrokenCustomerRefs: 0,
    usedExistingCustomers: 0,
    convertedGuestCustomers: 0,
    createdCustomers: 0,
    linkedAuthIdentities: 0,
    skippedMissingUser: 0,
    skippedMissingEmail: 0,
    errors: 0,
  }

  console.log(
    `[link-admin-users-to-customers] Starting (dryRun=${dryRun}, adminAuthIdentities=${adminAuthIdentities.length}, users=${usersById.size})`
  )

  for (const authIdentity of adminAuthIdentities) {
    const metadata = isRecord(authIdentity.app_metadata) ? authIdentity.app_metadata : {}
    const userId = toStringValue(metadata.user_id)
    const existingCustomerId = toStringValue(metadata.customer_id)

    if (!userId) {
      continue
    }

    const user = usersById.get(userId)
    if (!user) {
      stats.skippedMissingUser += 1
      console.warn(
        `[link-admin-users-to-customers] Skipping auth identity ${authIdentity.id}: user ${userId} not found`
      )
      continue
    }

    const email = normalizeEmail(user.email)
    if (!email) {
      stats.skippedMissingEmail += 1
      console.warn(
        `[link-admin-users-to-customers] Skipping auth identity ${authIdentity.id}: user ${user.id} has no email`
      )
      continue
    }

    try {
      let targetCustomerId: string | undefined = existingCustomerId
      let brokenCustomerRef = false

      if (existingCustomerId) {
        const linkedCustomer = await customerModuleService.listCustomers({ id: [existingCustomerId] }, { take: 1 })
        if (linkedCustomer.length) {
          stats.alreadyLinked += 1
          continue
        }

        brokenCustomerRef = true
      }

      if (!targetCustomerId || brokenCustomerRef) {
        const existingCustomer = await findPreferredCustomerByEmail(customerModuleService, email)

        if (existingCustomer) {
          targetCustomerId = existingCustomer.id
          stats.usedExistingCustomers += 1

          if (!existingCustomer.has_account && !dryRun) {
            await customerModuleService.updateCustomers(existingCustomer.id, {
              has_account: true,
            } as any)
            stats.convertedGuestCustomers += 1
          }
        } else if (!dryRun) {
          const [createdCustomer] = await customerModuleService.createCustomers([
            {
              email,
              first_name: user.first_name,
              last_name: user.last_name,
              has_account: true,
              created_by: "script:link-admin-users-to-customers",
            },
          ])

          targetCustomerId = createdCustomer.id
          stats.createdCustomers += 1
        } else {
          targetCustomerId = `dry_run_customer_for_${email}`
          stats.createdCustomers += 1
        }

        if (brokenCustomerRef) {
          stats.fixedBrokenCustomerRefs += 1
        }
      }

      if (!targetCustomerId) {
        throw new Error("No target customer ID resolved")
      }

      if (existingCustomerId === targetCustomerId) {
        stats.alreadyLinked += 1
        continue
      }

      if (!dryRun) {
        await authModuleService.updateAuthIdentities({
          id: authIdentity.id,
          app_metadata: {
            ...metadata,
            customer_id: targetCustomerId,
          },
        })
      }

      stats.linkedAuthIdentities += 1
    } catch (error) {
      stats.errors += 1
      console.error(
        `[link-admin-users-to-customers] Failed for auth identity ${authIdentity.id}:`,
        error
      )
    }
  }

  console.log("[link-admin-users-to-customers] Finished")
  console.log(JSON.stringify(stats, null, 2))
}
