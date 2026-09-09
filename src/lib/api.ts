import type {
  SignUpInput,
  SignInInput,
  VerifyEmailInput,
  ResendVerificationInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  CheckoutInput,
  CancelSubscriptionInput,
} from "../../shared/validation";

export interface BillingStatus {
  plan: "free" | "monthly" | "yearly";
  status: "active" | "non_renewing" | "past_due" | "cancelled";
  current_period_end: string | null;
  pending_plan_change: "monthly" | "yearly" | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
}

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  issues?: { fieldErrors: Record<string, string[] | undefined> };
  retryAfterSeconds?: number;

  constructor(
    status: number,
    message: string,
    issues?: { fieldErrors: Record<string, string[] | undefined> },
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    throw new ApiError(
      response.status,
      body.error ?? "Something went wrong",
      body.issues,
      retryAfter ? Number(retryAfter) : undefined,
    );
  }

  return body as T;
}

export const api = {
  signUp: (data: SignUpInput) =>
    request<{ email: string }>("/signup", { method: "POST", body: JSON.stringify(data) }),
  signIn: (data: SignInInput) =>
    request<{ email: string }>("/signin", { method: "POST", body: JSON.stringify(data) }),
  verifyEmail: (data: VerifyEmailInput) =>
    request<{ email: string }>("/verify-email", { method: "POST", body: JSON.stringify(data) }),
  resendVerification: (data: ResendVerificationInput) =>
    request<{ message: string }>("/resend-verification", { method: "POST", body: JSON.stringify(data) }),
  forgotPassword: (data: ForgotPasswordInput) =>
    request<{ message: string }>("/forgot-password", { method: "POST", body: JSON.stringify(data) }),
  resetPassword: (data: ResetPasswordInput) =>
    request<{ message: string }>("/reset-password", { method: "POST", body: JSON.stringify(data) }),
  signOut: () => request<{ message: string }>("/signout", { method: "POST" }),
  me: () => request<{ email: string }>("/me", { method: "GET" }),

  checkoutInit: (data: CheckoutInput) =>
    request<{ authorizationUrl: string; reference: string }>("/checkout-init", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  verifyPayment: (reference: string) =>
    request<{ granted: boolean; status: string; reason?: string }>(
      `/verify-payment?reference=${encodeURIComponent(reference)}`,
      { method: "GET" },
    ),
  billingStatus: () => request<BillingStatus>("/billing-status", { method: "GET" }),
  cancelSubscription: (data: CancelSubscriptionInput) =>
    request<{ message: string; accessUntil: string }>("/cancel-subscription", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  upgradeSubscription: () =>
    request<{ plan: string; amountCharged: number; credit: number; daysRemaining: number }>(
      "/upgrade-subscription",
      { method: "POST" },
    ),
  downgradeSubscription: () =>
    request<{ message: string; effectiveFrom: string }>("/downgrade-subscription", { method: "POST" }),
};
