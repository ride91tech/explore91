import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { api, setToken, loadToken, UserT } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

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

const processedSessionIds = new Set<string>();

function extractSessionId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserT | null>(null);
  const [loading, setLoading] = useState(true);
  const capturedUrlRef = useRef<string | null>(null);

  const exchangeSessionId = useCallback(async (session_id: string) => {
    if (processedSessionIds.has(session_id)) return;
    processedSessionIds.add(session_id);
    try {
      const res = await api<{ session_token: string; user: UserT }>("/auth/session", {
        method: "POST",
        body: JSON.stringify({ session_id }),
      });
      await setToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.log("session exchange failed", e);
    }
  }, []);

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

  // Boot: check for pending session_id (cold start) + validate stored token
  useEffect(() => {
    let mounted = true;
    (async () => {
      // Register listener BEFORE any auth work
      const sub = Linking.addEventListener("url", (evt) => {
        capturedUrlRef.current = evt.url;
        const sid = extractSessionId(evt.url);
        if (sid) exchangeSessionId(sid).then(refresh);
      });

      // On web, parse hash/query on mount
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const raw = window.location.href;
        const sid = extractSessionId(raw);
        if (sid) {
          await exchangeSessionId(sid);
          // clean the fragment
          try {
            const url = new URL(window.location.href);
            url.hash = "";
            url.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", url.toString());
          } catch {}
        }
      } else {
        const initial = await Linking.getInitialURL();
        const sid = extractSessionId(initial);
        if (sid) await exchangeSessionId(sid);
      }
      await refresh();
      if (mounted) setLoading(false);
      return () => sub.remove();
    })();
    return () => { mounted = false; };
  }, [exchangeSessionId, refresh]);

  const signIn = useCallback(async () => {
    let redirectUrl: string;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        // Preserve the current page (e.g. /admin) so users return to where they came from.
        redirectUrl = window.location.origin + window.location.pathname;
      } else {
        redirectUrl = "/";
      }
    } else {
      redirectUrl = Linking.createURL("");
    }
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }
    capturedUrlRef.current = null;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && (result as any).url) url = (result as any).url;
    if (!url) url = capturedUrlRef.current;
    if (!url) url = await Linking.getInitialURL();
    const sid = extractSessionId(url);
    if (sid) {
      await exchangeSessionId(sid);
      await refresh();
    }
  }, [exchangeSessionId, refresh]);

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
