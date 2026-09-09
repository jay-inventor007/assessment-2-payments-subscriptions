// Paystack plan codes aren't secret (they're not usable without the secret
// key), so they live here as config rather than as a Supabase secret.
export const plans = {
  monthly: {
    paystackPlanCode: "PLN_5xm5kn8vdy0fxrt",
    amount: 10000, // NGN 100, in kobo
    currency: "NGN",
  },
  yearly: {
    paystackPlanCode: "PLN_c7evnexv7g4aw17",
    amount: 100000, // NGN 1000, in kobo
    currency: "NGN",
  },
} as const;

export type PaidPlan = keyof typeof plans;
