import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getMe,
  logout as apiLogout,
  type PublicUser,
  refreshAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
  verifyOtp as apiVerifyOtp,
} from "../api/client";

interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  signInWithOtp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Runs once on app start: the access token is never persisted, so every
  // fresh page load has to silently re-establish it using the httpOnly
  // refresh cookie before we know whether anyone is signed in at all.
  useEffect(() => {
    let cancelled = false;

    setSessionExpiredHandler(() => {
      if (!cancelled) setUser(null);
    });

    async function bootstrap() {
      const token = await refreshAccessToken();
      if (token) {
        try {
          const me = await getMe();
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) setUser(null);
        }
      }
      if (!cancelled) setIsLoading(false);
    }

    void bootstrap();

    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, []);

  async function signInWithOtp(email: string, code: string): Promise<void> {
    const result = await apiVerifyOtp(email, code);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }

  async function signOut(): Promise<void> {
    await apiLogout();
    setAccessToken(null);
    setUser(null);
  }

  // Used after the Google OAuth redirect lands: the cookie and access token
  // are already in place by then, this just fetches who it is for.
  async function refreshUser(): Promise<void> {
    const me = await getMe();
    setUser(me);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signInWithOtp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
