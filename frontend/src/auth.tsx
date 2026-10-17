import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";
import { api, setToken, loadToken, UserT } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

/**
 * Google sign-in, split by platform because Google supports a different flow
 * on each.
 *
 * Native uses the Google Sign-In SDK. The previous implementation asked the
 * browser for `response_type=id_token` against the Android or iOS client,
 * which Google rejects outright: installed-app clients only support the
 * authorization-code flow, and a web client will not accept an `explore91://`
 * redirect. It could never have worked on a device whatever was configured in
 * the console.
 *
 * Web keeps the browser flow, which *is* supported there — an implicit
 * id_token against a Web client with an http(s) origin. The SDK has no real
 * web implementation; its web module throws "not implemented".
 */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

let googleConfigured = false;

/** Configure once, and only on native — `configure()` logs an error on web. */
function configureGoogle() {
  if (googleConfigured) return;
  GoogleSignin.configure({
    // Required for an ID token on Android; it is the "server" client, and the
    // backend accepts any client ID listed in GOOGLE_CLIENT_IDS, so whichever
    // of these Google stamps as the audience will verify.
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    scopes: ["openid", "profile", "email"],
  });
  googleConfigured = true;
}

/** Returns an ID token, or null if the user backed out. */
async function nativeGoogleIdToken(): Promise<string | null> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error(
      "Google Sign-In isn't configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID."
    );
  }
  configureGoogle();

  if (Platform.OS === "android") {
    // Throws if Play Services is missing or too old; the dialog offers the fix.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;   // cancelled

  const idToken = response.data.idToken;
  if (!idToken) throw new Error("Google didn't return an identity token.");
  return idToken;
}

async function webGoogleIdToken(): Promise<string | null> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error(
      "Google Sign-In isn't configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID."
    );
  }

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    redirectUri: AuthSession.makeRedirectUri(),
    scopes: ["openid", "profile", "email"],
    responseType: AuthSession.ResponseType.IdToken,
    extraParams: { nonce: Crypto.randomUUID() },
  });

  // No tokenEndpoint: the implicit flow returns the id_token on the redirect,
  // so there is no code to exchange.
  const result = await request.promptAsync({
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  });

  if (result.type !== "success") {
    if (result.type === "dismiss" || result.type === "cancel") return null;
    throw new Error("Google sign-in didn't complete. Please try again.");
  }

  const idToken = result.params?.id_token;
  if (!idToken) throw new Error("Google didn't return an identity token.");
  return idToken;
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
    const idToken =
      Platform.OS === "web" ? await webGoogleIdToken() : await nativeGoogleIdToken();

    // Backing out of the picker isn't an error worth surfacing.
    if (!idToken) return;

    const res = await api<{ session_token: string; user: UserT }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token: idToken }),
    });
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST", auth: true }); } catch {}
    // Clear the native session too, or the SDK silently re-uses the same
    // Google account on the next sign-in and the account picker never appears.
    if (Platform.OS !== "web") {
      try { await GoogleSignin.signOut(); } catch {}
    }
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
