import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { refreshAccessToken } from "../api/client";
import { PageSpinner } from "../components/PageSpinner";

// Landed on after a full-page redirect back from Google. The refresh-token
// cookie is already set by the backend at this point -- this just bootstraps
// the in-memory access token from it and looks up who signed in.
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const token = await refreshAccessToken();
      if (token) {
        try {
          await refreshUser();
        } catch {
          // Fall through to the redirect regardless of whether this succeeded.
        }
      }
      if (!cancelled) {
        navigate("/", { replace: true });
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <PageSpinner label="Signing you in…" />;
}
