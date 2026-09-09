import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type BillingStatus } from "../lib/api";
import { errorMessage } from "../lib/formErrors";
import { SignOutButton } from "../components/SignOutButton";

export function PlansPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingPlan, setSubmittingPlan] = useState<"monthly" | "yearly" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .billingStatus()
      .then(setBilling)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe(plan: "monthly" | "yearly") {
    setError(null);
    setSubmittingPlan(plan);
    try {
      const { authorizationUrl } = await api.checkoutInit({ plan });
      window.location.href = authorizationUrl;
    } catch (err) {
      setError(errorMessage(err));
      setSubmittingPlan(null);
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <p>Loading...</p>
      </main>
    );
  }

  const currentPlan = billing?.plan ?? "free";

  return (
    <main className="auth-page plans-page">
      <div className="page-header">
        <h1>Plans</h1>
        <SignOutButton />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="plan-cards">
        <PlanCard name="Free" price="N0" isCurrent={currentPlan === "free"} />
        <PlanCard
          name="Monthly"
          price="N100 / month"
          isCurrent={currentPlan === "monthly"}
          action={
            currentPlan === "free" ? (
              <button onClick={() => handleSubscribe("monthly")} disabled={submittingPlan !== null}>
                {submittingPlan === "monthly" ? "Redirecting..." : "Subscribe"}
              </button>
            ) : null
          }
        />
        <PlanCard
          name="Yearly"
          price="N1000 / year"
          isCurrent={currentPlan === "yearly"}
          action={
            currentPlan === "free" ? (
              <button onClick={() => handleSubscribe("yearly")} disabled={submittingPlan !== null}>
                {submittingPlan === "yearly" ? "Redirecting..." : "Subscribe"}
              </button>
            ) : null
          }
        />
      </div>
      {currentPlan !== "free" && (
        <p>
          <Link to="/billing">Manage billing</Link>
        </p>
      )}
    </main>
  );
}

function PlanCard({
  name,
  price,
  isCurrent,
  action,
}: {
  name: string;
  price: string;
  isCurrent: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={isCurrent ? "plan-card plan-card-current" : "plan-card"}>
      <h2>{name}</h2>
      <p>{price}</p>
      {isCurrent && <p className="plan-current-badge">Current plan</p>}
      {action}
    </div>
  );
}
