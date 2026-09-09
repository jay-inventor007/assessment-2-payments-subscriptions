import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FormField } from "../components/FormField";
import { api } from "../lib/api";
import { errorMessage, flattenIssues } from "../lib/formErrors";
import { resetPasswordSchema } from "../../shared/validation";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldErrors(flattenIssues(parsed.error));
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await api.resetPassword(parsed.data);
      navigate("/signin", { state: { justReset: true } });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <main className="auth-page">
        <h1>Reset password</h1>
        <p className="form-error">
          This page needs a reset link. <Link to="/forgot-password">Request a new one</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <h1>Choose a new password</h1>
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Updating..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
