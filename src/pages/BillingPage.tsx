import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type BillingStatus } from "../lib/api";
import { FormField } from "../components/FormField";
import { SignOutButton } from "../components/SignOutButton";
import { errorMessage } from "../lib/formErrors";

function formatNaira(kobo: number): string {
  return `N${(kobo / 100).toFixed(2)}`;
}

export function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  async function load() {
    try {
      setBilling(await api.billingStatus());
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpgrade() {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api.upgradeSubscription();
      setNotice(
        `Upgraded to yearly. Charged ${formatNaira(result.amountCharged)} after a ${formatNaira(result.credit)} credit for unused time on the monthly plan.`,
      );
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDowngrade() {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api.downgradeSubscription();
      setNotice(result.message);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmCancel() {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api.cancelSubscription({ reason: cancelReason || undefined });
      setNotice(result.message);
      setConfirmingCancel(false);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <p>Loading...</p>
      </main>
    );
  }

  if (!billing) return null;

  return (
    <main className="auth-page">
      <div className="page-header">
        <h1>Billing</h1>
        <SignOutButton />
      </div>
      <p>Plan: {billing.plan}</p>
      <p>Status: {billing.status}</p>
      {billing.current_period_end && (
        <p>
          {billing.status === "non_renewing" ? "Access until" : "Renews on"}:{" "}
          {new Date(billing.current_period_end).toLocaleDateString()}
        </p>
      )}
      {billing.pending_plan_change && (
        <p className="form-notice">
          Scheduled to switch to {billing.pending_plan_change} at the end of this period.
        </p>
      )}
      {billing.cancellation_reason && <p>Cancellation reason: {billing.cancellation_reason}</p>}

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      {billing.plan === "monthly" && billing.status === "active" && (
        <button onClick={handleUpgrade} disabled={busy}>
          Upgrade to yearly
        </button>
      )}
      {billing.plan === "yearly" && billing.status === "active" && !billing.pending_plan_change && (
        <button onClick={handleDowngrade} disabled={busy}>
          Downgrade to monthly
        </button>
      )}

      {billing.plan !== "free" && billing.status === "active" && !confirmingCancel && (
        <button onClick={() => setConfirmingCancel(true)} disabled={busy}>
          Cancel subscription
        </button>
      )}

      {confirmingCancel && (
        <div className="cancel-confirm">
          <p>Are you sure? You'll keep access until your current period ends.</p>
          <FormField
            label="Reason (optional)"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />
          <button onClick={handleConfirmCancel} disabled={busy}>
            Confirm cancellation
          </button>
          <button type="button" onClick={() => setConfirmingCancel(false)} disabled={busy}>
            Never mind
          </button>
        </div>
      )}

      <p>
        <Link to="/plans">Back to plans</Link>
      </p>
    </main>
  );
}
