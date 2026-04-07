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

export type MedusaAdminLoginRequest = z.infer<typeof MedusaAdminLoginRequestSchema>;
export type MedusaAdminLoginResponse = z.infer<typeof MedusaAdminLoginResponseSchema>;
export type MedusaAdminUser = z.infer<typeof MedusaAdminUserSchema>;
