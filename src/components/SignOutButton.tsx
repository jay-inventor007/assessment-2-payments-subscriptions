import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export function SignOutButton() {
  const { refresh } = useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await api.signOut();
    await refresh();
    navigate("/signin");
  }

  return (
    <button type="button" onClick={handleSignOut} className="sign-out-button">
      Sign out
    </button>
  );
}
