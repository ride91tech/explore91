import { Stack, useRouter } from "expo-router";
import { useRouteSegments } from "@/src/routing";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useAppFonts } from "@/src/hooks/use-icon-fonts";
import { colors } from "@/src/theme";
import { AuthProvider, useAuth } from "@/src/auth";
import { ToastHost } from "@/src/components/Toast";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useRouteSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    const second = segments[1];
    const inAuth = first === "login";

    // explore91.com is browse-first: home, discover, reels, place pages and
    // the city picker are all open, and you sign in only for the parts that
    // are about you. Guarding those instead of the whole app means a visitor
    // who has just installed it can look around before being asked for an
    // account. Admin and owner keep their own gates.
    const needsAccount =
      (first === "(tabs)" && (second === "trips" || second === "profile")) ||
      first === "bookings" ||
      first === "book" ||
      first === "support";

    if (!user && needsAccount) router.replace("/login");
    if (user && inAuth) {
      // Honor ?returnTo=/owner if present
      const returnTo = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("returnTo")
        : null;
      router.replace((returnTo || "/(tabs)") as any);
    }
  }, [user, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="business/[id]" options={{ presentation: "card", animation: "slide_from_right" }} />
      <Stack.Screen name="book/[id]" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="city" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="ai/index" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="ai/itinerary" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="owner" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="support" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="bookings" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useAppFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastHost>
            <StatusBar style="dark" />
            <AuthGate />
          </ToastHost>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
