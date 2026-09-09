import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { errorMessage } from "../lib/formErrors";

// This page proves nothing on its own - landing here is just a browser
// redirect, which anyone could visit directly with any reference. The only
// thing that matters is the verify-payment call below, which checks with
// Paystack itself server-side before anything is treated as paid.
export function CheckoutReturnPage() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference");
  const [state, setState] = useState<"checking" | "granted" | "failed">("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!reference) {
      setState("failed");
      setMessage("No payment reference found in the URL.");
      return;
    }

    api
      .verifyPayment(reference)
      .then((result) => {
        if (result.granted) {
          setState("granted");
        } else {
          setState("failed");
          setMessage(result.reason ?? "Payment could not be verified.");
        }
      })
      .catch((err) => {
        setState("failed");
        setMessage(errorMessage(err));
      });
  }, [reference]);

  return (
    <main className="auth-page">
      <h1>Payment</h1>
      {state === "checking" && <p>Verifying your payment...</p>}
      {state === "granted" && (
        <>
          <p className="form-notice">Payment confirmed. Your plan is now active.</p>
          <p>
            <Link to="/billing">View billing</Link>
          </p>
        </>
      )}
      {state === "failed" && (
        <>
          <p className="form-error" role="alert">
            {message}
          </p>
          <p>
            <Link to="/plans">Back to plans</Link>
          </p>
        </>
      )}
    </main>
  );
}
