import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { ToastHost } from "@/src/components/Toast";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    const inAuth = first === "login";
    const inAdmin = first === "admin";     // web-only admin has its own gate
    const inOwner = first === "owner";     // owner portal has its own gate
    if (!user && !inAuth && !inAdmin && !inOwner) router.replace("/login");
    if (user && inAuth) {
      // Honor ?returnTo=/owner if present
      const returnTo = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("returnTo")
        : null;
      router.replace((returnTo || "/(tabs)") as any);
    }
  }, [user, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#FFFFFF" } }}>
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
  const [loaded, error] = useIconFonts();

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
