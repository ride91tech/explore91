import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { api, setToken, loadToken, UserT } from "@/src/api";

/**
 * Sign-in, standing in for Google until OTP lands.
 *
 * `signIn` takes an identifier and exchanges it for a session with no
 * credential of any kind -- see the backend's /auth/dev, which is inert
 * unless DEV_AUTH_ENABLED is set on the server. The signature is
 * deliberately (identifier, name?) rather than () so that swapping in OTP
 * means adding a second step, not rewriting every caller.
 */
type Ctx = {
  user: UserT | null;
  loading: boolean;
  signIn: (email: string, name?: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  loading: true,
  signIn: async () => {},
  signInWithApple: async () => {},
  signOut: async () => {},
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserT | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await loadToken();
      if (!t) { setUser(null); return; }
      const u = await api<UserT>("/auth/me", { auth: true });
      setUser(u);
    } catch (e: any) {
      if (e?.status === 401) {
        await setToken(null);
      }
      setUser(null);
    }
  }, []);

  // Boot: validate any stored token. The old provider also had to catch a
  // session_id handed back on a redirect; sign-in now completes in-process, so
  // there's nothing to intercept on cold start.
  useEffect(() => {
    let mounted = true;
    refresh().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refresh]);

  const signIn = useCallback(async (email: string, name?: string) => {
    const res = await api<{ session_token: string; user: UserT }>("/auth/dev", {
      method: "POST",
      body: JSON.stringify({ email, name: name ?? null }),
    });
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST", auth: true }); } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== "ios") {
      throw new Error("Apple sign-in is only available on iOS.");
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error("Apple did not return an identity token.");
    }
    // Apple returns fullName/email ONLY on the first sign-in — forward both.
    const fullName =
      credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(" ")
            .trim() || null
        : null;
    const res = await api<{ session_token: string; user: UserT }>("/auth/apple", {
      method: "POST",
      body: JSON.stringify({
        identity_token: credential.identityToken,
        email: credential.email ?? null,
        full_name: fullName,
      }),
    });
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signInWithApple, signOut, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}
