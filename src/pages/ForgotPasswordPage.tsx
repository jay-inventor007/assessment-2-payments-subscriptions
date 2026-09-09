import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FormField } from "../components/FormField";
import { api } from "../lib/api";
import { errorMessage, flattenIssues } from "../lib/formErrors";
import { forgotPasswordSchema } from "../../shared/validation";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldErrors(flattenIssues(parsed.error));
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const result = await api.forgotPassword(parsed.data);
      setNotice(result.message);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>Forgot password</h1>
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        {notice && <p className="form-notice">{notice}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
      <p>
        <Link to="/signin">Back to sign in</Link>
      </p>
    </main>
  );
}
