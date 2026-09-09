import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

type SessionState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; email: string };

const SessionContext = createContext<{ state: SessionState; refresh: () => Promise<void> } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  async function refresh() {
    try {
      const { email } = await api.me();
      setState({ status: "signed-in", email });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: "signed-out" });
      } else {
        throw error;
      }
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <SessionContext.Provider value={{ state, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider");
  return context;
}
