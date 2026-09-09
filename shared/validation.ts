// Imported by both the React app (via the Vite "npm:" alias in vite.config.ts)
// and the Deno Edge Functions (which resolve "npm:zod@..." natively) - see
// vite.config.ts for why the specifier looks like this instead of "zod".
import { z } from "npm:zod@4.5.4";

export const emailSchema = z.email("Enter a valid email address").max(254);

// Length over complexity rules: NIST 800-63B recommends a minimum length
// rather than forced character classes, since forced classes push people
// toward predictable substitutions (Password1! for Password1) without
// meaningfully raising guess difficulty.
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be at most 72 characters"); // bcrypt ignores bytes past 72

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z.string().length(6, "Enter the 6-digit code"),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const planSchema = z.enum(["monthly", "yearly"]);

export const checkoutSchema = z.object({
  plan: planSchema,
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const changePlanSchema = z.object({
  plan: planSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type ChangePlanInput = z.infer<typeof changePlanSchema>;
