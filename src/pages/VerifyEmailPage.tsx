import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FormField } from "../components/FormField";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { errorMessage, flattenIssues } from "../lib/formErrors";
import { verifyEmailSchema } from "../../shared/validation";

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const navigate = useNavigate();
  const { refresh } = useSession();

  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    const parsed = verifyEmailSchema.safeParse({ email, code });
    if (!parsed.success) {
      setFieldErrors(flattenIssues(parsed.error));
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await api.verifyEmail(parsed.data);
      await refresh();
      navigate("/plans");
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setFormError(null);
    setNotice(null);
    setResending(true);
    try {
      const result = await api.resendVerification({ email });
      setNotice(result.message);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>Verify your email</h1>
      <p>We sent a 6-digit code to {email || "your email address"}.</p>
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Verification code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={fieldErrors.code}
        />
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        {notice && <p className="form-notice">{notice}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Verifying..." : "Verify"}
        </button>
      </form>
      <button type="button" onClick={handleResend} disabled={resending || cooldown > 0}>
        {cooldown > 0 ? `Resend code (${cooldown}s)` : resending ? "Sending..." : "Resend code"}
      </button>
    </main>
  );
}
