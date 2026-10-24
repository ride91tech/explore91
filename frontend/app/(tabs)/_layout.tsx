import React from "react";
import { Tabs } from "expo-router";
import { TabBar } from "@/src/components/TabBar";

/**
 * The bar itself lives in src/components/TabBar — the dark ink colour and the
 * raised Reels button cannot be expressed through screenOptions, so the whole
 * bar is rendered rather than configured. Titles stay here because that is
 * what the navigator hands the bar as each tab's label.
 *
 * Reels is deliberately third of five: TabBar raises the entry named "reels",
 * and the middle position is what makes the raised button read as centred.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="explore" options={{ title: "Discover" }} />
      <Tabs.Screen name="reels" options={{ title: "Reels" }} />
      <Tabs.Screen name="trips" options={{ title: "Trips" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
