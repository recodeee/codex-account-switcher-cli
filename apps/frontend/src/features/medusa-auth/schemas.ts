import { z } from "zod";

export const MedusaAdminLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MedusaAdminLoginTokenSchema = z.object({
  token: z.string().min(1),
});

const MedusaAdminLoginRedirectSchema = z.object({
  location: z.string().min(1),
});

export const MedusaAdminLoginResponseSchema = z.union([
  MedusaAdminLoginTokenSchema,
  MedusaAdminLoginRedirectSchema,
]);

export const MedusaAdminUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

export const MedusaAdminUserResponseSchema = z.object({
  user: MedusaAdminUserSchema,
});

export const MedusaAdminSecondFactorStatusSchema = z.object({
  email: z.string().email(),
  totpEnabled: z.boolean(),
});

export const MedusaAdminSecondFactorSetupStartResponseSchema = z.object({
  email: z.string().email(),
  totpEnabled: z.boolean(),
  secret: z.string().min(1),
  otpauthUri: z.string().min(1),
  qrSvgDataUri: z.string().min(1),
});

export const MedusaAdminSecondFactorVerifyResponseSchema = z.object({
  status: z.literal("ok"),
});

export type MedusaAdminLoginRequest = z.infer<typeof MedusaAdminLoginRequestSchema>;
export type MedusaAdminLoginResponse = z.infer<typeof MedusaAdminLoginResponseSchema>;
export type MedusaAdminUser = z.infer<typeof MedusaAdminUserSchema>;
export type MedusaAdminSecondFactorStatus = z.infer<typeof MedusaAdminSecondFactorStatusSchema>;
export type MedusaAdminSecondFactorSetupStartResponse = z.infer<
  typeof MedusaAdminSecondFactorSetupStartResponseSchema
>;
