/**
 * explore91.com/city/<slug>, opened in the app.
 *
 * Shared city links open the installed app, which had no route for them and
 * showed "Unmatched Route". Until the app picks its city from the device's
 * location (and can switch city without an account), this lands on Home
 * rather than a dead end. Home still shows the city the app already uses.
 */
import { Redirect } from "expo-router";

export default function CityLink() {
  return <Redirect href="/(tabs)" />;
}
