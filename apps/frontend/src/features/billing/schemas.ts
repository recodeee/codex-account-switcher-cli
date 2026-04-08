import { z } from "zod";

export const BillingMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: z.enum(["Owner", "Member"]),
  seatType: z.enum(["ChatGPT", "Codex"]),
  dateAdded: z.string(),
});

export const BillingCycleSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

export const BillingAccountSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  planCode: z.string().min(1),
  planName: z.string().min(1),
  subscriptionStatus: z.enum(["trialing", "active", "past_due", "canceled", "expired"]),
  entitled: z.boolean(),
  paymentStatus: z.enum(["paid", "requires_action", "past_due", "unpaid"]),
  billingCycle: BillingCycleSchema,
  renewalAt: z.coerce.date().nullable(),
  chatgptSeatsInUse: z.number().int().nonnegative(),
  codexSeatsInUse: z.number().int().nonnegative(),
  members: z.array(BillingMemberSchema),
});

export const BillingAccountsResponseSchema = z.object({
  accounts: z.array(BillingAccountSchema),
});

export const BillingAccountsUpdateRequestSchema = z.object({
  accounts: z.array(BillingAccountSchema),
});

export const BillingAccountCreateRequestSchema = z.object({
  domain: z.string().min(1),
  planCode: z.string().min(1).default("business"),
  planName: z.string().min(1).default("Business"),
  subscriptionStatus: z
    .enum(["trialing", "active", "past_due", "canceled", "expired"])
    .default("active"),
  paymentStatus: z.enum(["paid", "requires_action", "past_due", "unpaid"]).default("paid"),
  entitled: z.boolean().default(true),
  renewalAt: z.coerce.date().nullable().optional(),
  chatgptSeatsInUse: z.number().int().nonnegative().default(0),
  codexSeatsInUse: z.number().int().nonnegative().default(0),
});

export type BillingMember = z.infer<typeof BillingMemberSchema>;
export type BillingCycle = z.infer<typeof BillingCycleSchema>;
export type BillingAccount = z.infer<typeof BillingAccountSchema>;
export type BillingAccountsResponse = z.infer<typeof BillingAccountsResponseSchema>;
export type BillingAccountsUpdateRequest = z.infer<typeof BillingAccountsUpdateRequestSchema>;
export type BillingAccountCreateRequest = z.infer<typeof BillingAccountCreateRequestSchema>;
