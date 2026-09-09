import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useSession } from "../lib/session";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useSession();

  if (state.status === "loading") return <p>Loading...</p>;
  if (state.status === "signed-out") return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
