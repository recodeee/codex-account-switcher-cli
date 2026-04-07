import { MedusaContainer } from "@medusajs/framework"
import { ModuleRegistrationName } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

export default async function createPublishableKey({
  container,
}: {
  container: MedusaContainer
}) {
  const salesChannelModuleService = container.resolve(ModuleRegistrationName.SALES_CHANNEL)

  const salesChannels = await salesChannelModuleService.listSalesChannels({})
  if (!Array.isArray(salesChannels) || salesChannels.length === 0) {
    throw new Error("Nem található sales channel, ezért nem hozható létre publishable key.")
  }

  const title = process.env.PUBLISHABLE_KEY_TITLE?.trim() || "Storefront"
  const createdBy = process.env.PUBLISHABLE_KEY_CREATED_BY?.trim() || "cli"

  const { result } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title,
          type: "publishable",
          created_by: createdBy,
        },
      ],
    },
  })

  const createdKey = result[0]
  if (!createdKey?.id || !createdKey?.token) {
    throw new Error("A publishable key létrehozása sikertelen.")
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: createdKey.id,
      add: salesChannels.map((channel: { id: string }) => channel.id),
    },
  })

  console.log(
    JSON.stringify(
      {
        id: createdKey.id,
        title: createdKey.title,
        token: createdKey.token,
        sales_channel_ids: salesChannels.map((channel: { id: string }) => channel.id),
      },
      null,
      2
    )
  )
}
