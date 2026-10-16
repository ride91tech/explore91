import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { api, setToken, loadToken, UserT } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

/** Google OAuth client IDs, one per platform, from the Google Cloud console.
 *  Web and native builds must use different clients — Google rejects a token
 *  minted for the wrong one, which is what prevents cross-app replay. */
function googleClientId(): string | undefined {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
}

type Ctx = {
  user: UserT | null;
  loading: boolean;
  signIn: () => Promise<void>;
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

  const signIn = useCallback(async () => {
    const clientId = googleClientId();
    if (!clientId) {
      throw new Error(
        "Google Sign-In isn't configured for this platform. Set the EXPO_PUBLIC_GOOGLE_*_CLIENT_ID values."
      );
    }

    const redirectUri = AuthSession.makeRedirectUri({ scheme: "explore91" });
    const discovery = {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    };

    // Ask Google for an ID token directly. The backend verifies it against
    // Google's published keys, so no third party sits in the login path.
    const nonce = Crypto.randomUUID();
    const authRequest = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: ["openid", "profile", "email"],
      responseType: AuthSession.ResponseType.IdToken,
      extraParams: { nonce },
    });

    const result = await authRequest.promptAsync(discovery);
    if (result.type !== "success") {
      // Cancelling isn't an error worth surfacing.
      if (result.type === "dismiss" || result.type === "cancel") return;
      throw new Error("Google sign-in didn't complete. Please try again.");
    }

    const idToken = result.params?.id_token;
    if (!idToken) throw new Error("Google didn't return an identity token.");

    const res = await api<{ session_token: string; user: UserT }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token: idToken }),
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
