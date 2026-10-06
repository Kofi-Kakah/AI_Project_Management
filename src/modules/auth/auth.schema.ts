import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(120),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const emailSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const verificationTokenQuerySchema = z.object({
  token: z.string().min(1),
});
