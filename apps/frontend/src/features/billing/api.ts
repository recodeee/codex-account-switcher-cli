import { del, get, post, put } from "@/lib/api-client";
import {
  BillingAccountCreateRequestSchema,
  BillingAccountDeleteRequestSchema,
  BillingAccountSchema,
  BillingAccountsResponseSchema,
  BillingAccountsUpdateRequestSchema,
} from "@/features/billing/schemas";

const BILLING_PATH = "/api/billing";
const BILLING_ACCOUNTS_PATH = "/api/billing/accounts";

export function getBillingAccounts() {
  return get(BILLING_PATH, BillingAccountsResponseSchema);
}

export function updateBillingAccounts(payload: unknown) {
  const validated = BillingAccountsUpdateRequestSchema.parse(payload);
  return put(BILLING_PATH, BillingAccountsResponseSchema, { body: validated });
}

export function createBillingAccount(payload: unknown) {
  const validated = BillingAccountCreateRequestSchema.parse(payload);
  return post(BILLING_ACCOUNTS_PATH, BillingAccountSchema, { body: validated });
}

export function deleteBillingAccount(payload: unknown) {
  const validated = BillingAccountDeleteRequestSchema.parse(payload);
  return del(BILLING_ACCOUNTS_PATH, { body: validated });
}
