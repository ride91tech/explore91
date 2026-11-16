/**
 * explore91.com/reel/<id>, opened in the app.
 *
 * A shared reel should land on that reel, not on the place it is of. This
 * hands the id to the Reels tab, which puts it first in the feed — so the
 * person can keep scrolling the city from there — and swaps itself out, so
 * Back doesn't return to a blank redirect screen. A missing reel is reported
 * by the feed, which still has something to show.
 */
import { Redirect, useLocalSearchParams } from "expo-router";

export default function ReelLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/(tabs)/reels", params: { reel: id ?? "" } }} />;
}
