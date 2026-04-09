import { z } from "zod";

export const MedusaCustomerLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const MedusaCustomerRegisterRequestSchema = MedusaCustomerLoginRequestSchema.extend({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
});

const MedusaAuthTokenSchema = z.object({
  token: z.string().min(1),
});

const MedusaAuthRedirectSchema = z.object({
  location: z.string().min(1),
});

export const MedusaAuthResponseSchema = z.union([
  MedusaAuthTokenSchema,
  MedusaAuthRedirectSchema,
]);

export const MedusaCustomerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const MedusaCustomerResponseSchema = z.object({
  customer: MedusaCustomerSchema,
});

export type MedusaCustomerLoginRequest = z.infer<
  typeof MedusaCustomerLoginRequestSchema
>;
export type MedusaCustomerRegisterRequest = z.infer<
  typeof MedusaCustomerRegisterRequestSchema
>;
export type MedusaCustomer = z.infer<typeof MedusaCustomerSchema>;
