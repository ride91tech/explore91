import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  Pressable,
  ActivityIndicator,
  Platform,
  Share,
  Linking,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { VideoView, useVideoPlayer } from "expo-video";
import { api, InterestPlace, InterestStatus, ReelT } from "@/src/api";
import { reelCta, mapsUrl } from "@/src/reelCta";
import { placeUrl, shareContent } from "@/src/links";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/Toast";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

const TAB_BAR = 82;

export default function ReelsFeed() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { show } = useToast();
  const { height, width } = Dimensions.get("window");
  const itemH = height - TAB_BAR;

  const [reels, setReels] = useState<ReelT[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [screenFocused, setScreenFocused] = useState(false);
  const [topics, setTopics] = useState<{ slug: string; name: string; count: number }[]>([]);
  const [topic, setTopic] = useState<string | null>(null);   // null = For you
  // business_id -> interested/going/visited, so the rail reflects what you
  // already flagged when a reel scrolls back into view.
  const [interest, setInterest] = useState<Record<string, InterestStatus>>({});

  const cityLower = (user?.home_city ?? "Goa").toLowerCase();

  const load = useCallback(async () => {
    try {
      const feed = topic
        ? `/reels?city=${cityLower}&category=${topic}&limit=30`
        : `/reels?city=${cityLower}&limit=30`;
      const [list, likes, rails, flagged] = await Promise.all([
        api<ReelT[]>(feed),
        user ? api<string[]>("/reels/my/likes", { auth: true }).catch(() => []) : Promise.resolve([]),
        api<{ slug: string; name: string; count: number }[]>(
          `/reels/topics?city=${cityLower}`
        ).catch(() => []),
        user
          ? api<InterestPlace[]>("/places/interest", { auth: true }).catch(() => [])
          : Promise.resolve([] as InterestPlace[]),
      ]);
      setReels(list);
      setLikedIds(new Set(likes));
      setTopics(rails);
      setInterest(
        Object.fromEntries(flagged.map((f) => [f.business_id, f.interest_status]))
      );
    } catch (e) { console.log("reels", e); }
    finally { setLoading(false); }
  }, [cityLower, user, topic]);

  useEffect(() => { load(); }, [load]);

  /** Interested / Going / Visited, straight onto the place. Tapping the
   *  active one again clears it, so the rail is a toggle, not a ratchet. */
  const flagPlace = useCallback(
    async (businessId: string, status: InterestStatus) => {
      if (!user) { router.push("/login"); return; }
      const prev = interest[businessId];
      const next = prev === status ? undefined : status;

      setInterest((m) => {
        const copy = { ...m };
        if (next) copy[businessId] = next;
        else delete copy[businessId];
        return copy;
      });

      try {
        if (next) {
          await api(`/places/${businessId}/interest`, {
            method: "PUT", auth: true,
            body: JSON.stringify({ status: next }),
          });
        } else {
          await api(`/places/${businessId}/interest`, { method: "DELETE", auth: true });
        }
      } catch (e: any) {
        // Put the rail back where it was rather than leaving it lying.
        setInterest((m) => {
          const copy = { ...m };
          if (prev) copy[businessId] = prev;
          else delete copy[businessId];
          return copy;
        });
        show(e?.status === 401 ? "Sign in to save places." : "Couldn't save that.", "error");
      }
    },
    [user, interest, router, show]
  );

  /** Opening directions is what fills in the journey map — the site says it
   *  happens on its own, and this is the wiring behind that. */
  const openDirections = useCallback(
    async (reel: ReelT) => {
      try {
        await Linking.openURL(mapsUrl(reel.business_name, reel.city));
      } catch {
        show("Couldn't open maps.", "error");
        return;
      }
      if (user) {
        api("/journey/visit", {
          method: "POST", auth: true,
          body: JSON.stringify({ city_slug: reel.city }),
        }).catch(() => {});
      }
    },
    [user, show]
  );

  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
      // Track view (fire and forget)
      const reel = viewableItems[0].item as ReelT;
      if (reel?.reel_id) api(`/reels/${reel.reel_id}/view`, { method: "POST" }).catch(() => {});
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  const shareReel = useCallback(async (reel: ReelT) => {
    const where = reel.business_name ? ` at ${reel.business_name}` : "";
    try {
      // Reels have no page of their own yet, so share the place the reel is
      // of — that is the thing with a public URL and a preview card.
      await Share.share(
        shareContent(`${reel.caption}${where}`, placeUrl(reel.business_slug))
      );
    } catch {
      show("Couldn't open sharing. Try again.", "error");
    }
  }, [show]);

  const toggleLike = useCallback(async (reelId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Optimistic
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (next.has(reelId)) next.delete(reelId); else next.add(reelId);
      return next;
    });
    setReels((prev) => prev.map((r) => r.reel_id === reelId ? { ...r, likes: r.likes + (likedIds.has(reelId) ? -1 : 1) } : r));
    try {
      const res = await api<{ liked: boolean; likes: number }>("/reels/like", {
        method: "POST", auth: true,
        body: JSON.stringify({ reel_id: reelId }),
      });
      setLikedIds((prev) => {
        const next = new Set(prev);
        res.liked ? next.add(reelId) : next.delete(reelId);
        return next;
      });
      setReels((prev) => prev.map((r) => r.reel_id === reelId ? { ...r, likes: res.likes } : r));
    } catch (e: any) {
      // Roll the optimistic update back so the heart matches the server.
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (next.has(reelId)) next.delete(reelId); else next.add(reelId);
        return next;
      });
      setReels((prev) => prev.map((r) => r.reel_id === reelId
        ? { ...r, likes: r.likes + (likedIds.has(reelId) ? 1 : -1) }
        : r));
      show(e?.status === 401 ? "Sign in to like reels." : "Couldn't save that like.", "error");
    }
  }, [likedIds, show]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color="#FFF" />
      </View>
    );
  }

  if (reels.length === 0) {
    return (
      <View style={[styles.loader, { padding: spacing.xl }]}>
        <Ionicons name="videocam-outline" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={styles.emptyTitle}>No reels yet in {user?.home_city ?? "Goa"}</Text>
        <Text style={styles.emptySub}>Come back soon — creators post new reels every day.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={reels}
        keyExtractor={(r) => r.reel_id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={itemH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: itemH, offset: itemH * index, index })}
        windowSize={3}
        renderItem={({ item, index }) => (
          <ReelItem
            reel={item}
            active={index === activeIndex && screenFocused}
            liked={likedIds.has(item.reel_id)}
            onLike={() => toggleLike(item.reel_id)}
            onOpenBusiness={() => item.business_id && router.push(`/business/${item.business_id}`)}
            onShare={() => shareReel(item)}
            interest={item.business_id ? interest[item.business_id] : undefined}
            onFlag={(status) => item.business_id && flagPlace(item.business_id, status)}
            onDirections={() => openDirections(item)}
            height={itemH}
            width={width}
            insets={insets}
          />
        )}
      />

      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <Text style={styles.brand}>Reels</Text>
        <Text style={styles.cityBadge}>{user?.home_city ?? "Goa"}</Text>
      </View>

      {/* Topic rails. Built from what the city actually has, so a rail never
          opens onto an empty feed. */}
      {topics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.rails, { top: insets.top + 46 }]}
          contentContainerStyle={styles.railsInner}
        >
          <TopicChip
            label="For you"
            active={topic === null}
            onPress={() => setTopic(null)}
            testID="reel-topic-foryou"
          />
          {topics.map((t) => (
            <TopicChip
              key={t.slug}
              label={t.name}
              active={topic === t.slug}
              onPress={() => setTopic(t.slug)}
              testID={`reel-topic-${t.slug}`}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function ReelItem({
  reel,
  active,
  liked,
  onLike,
  onOpenBusiness,
  onShare,
  interest,
  onFlag,
  onDirections,
  height,
  width,
  insets,
}: {
  reel: ReelT;
  active: boolean;
  liked: boolean;
  onLike: () => void;
  onOpenBusiness: () => void;
  onShare: () => void;
  interest?: InterestStatus;
  onFlag: (status: InterestStatus) => void;
  onDirections: () => void;
  height: number;
  width: number;
  insets: { top: number; bottom: number };
}) {
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(reel.video_url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (active) player.play(); else player.pause();
  }, [active, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  return (
    <Pressable
      onPress={() => setMuted((m) => !m)}
      style={[reelStyles.item, { height, width }]}
    >
      <View style={reelStyles.videoBox}>
        <Image
          source={{ uri: reel.cover_image }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        {Platform.OS !== "web" ? (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            nativeControls={false}
            contentFit="cover"
          />
        ) : null}
      </View>

      {/* Gradient scrims */}
      <LinearGradient
        colors={["rgba(0,0,0,0.5)", "transparent"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 140 }}
      />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.85)"]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 280 }}
      />

      {/* Muted indicator */}
      {muted ? (
        <View style={reelStyles.mutePill}>
          <Ionicons name="volume-mute" size={12} color="#FFF" />
          <Text style={reelStyles.mutePillText}>Tap to unmute</Text>
        </View>
      ) : null}

      {/* Right action rail */}
      <View style={[reelStyles.rail, { bottom: 120 + insets.bottom }]}>
        <ReelAction
          testID={`reel-like-${reel.reel_id}`}
          icon={liked ? "heart" : "heart-outline"}
          color={liked ? colors.brandTertiary : "#FFF"}
          label={reel.likes.toLocaleString()}
          onPress={onLike}
        />
        {/* The site puts Going / Interested on every reel. These write
            straight through to the place, and Visited is what the map reads. */}
        {reel.business_id ? (
          <>
            <ReelAction
              testID={`reel-going-${reel.reel_id}`}
              icon={interest === "going" ? "checkmark-circle" : "checkmark-circle-outline"}
              color={interest === "going" ? colors.brandTertiary : "#FFF"}
              label="Going"
              onPress={() => onFlag("going")}
            />
            <ReelAction
              testID={`reel-interested-${reel.reel_id}`}
              icon={interest === "interested" ? "bookmark" : "bookmark-outline"}
              color={interest === "interested" ? colors.brandTertiary : "#FFF"}
              label="Interested"
              onPress={() => onFlag("interested")}
            />
          </>
        ) : null}
        <ReelAction
          testID={`reel-share-${reel.reel_id}`}
          icon="paper-plane-outline"
          label="Share"
          onPress={onShare}
        />
      </View>

      {/* Bottom content */}
      <View style={[reelStyles.bottom, { paddingBottom: insets.bottom + 100 }]}>
        <View style={{ flex: 1 }}>
          <Text style={reelStyles.author}>@{(reel.author || "explore91").replace(/\s+/g, "").toLowerCase()}</Text>
          <Text style={reelStyles.caption}>{reel.caption}</Text>
          {reel.business_name ? (
            <Pressable
              testID={`reel-biz-${reel.reel_id}`}
              onPress={onOpenBusiness}
              style={reelStyles.bizChip}
            >
              <Ionicons name="location" size={12} color="#FFF" />
              <Text style={reelStyles.bizChipText} numberOfLines={1}>{reel.business_name}</Text>
              <Ionicons name="chevron-forward" size={12} color="#FFF" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* The call to action depends on what this is a reel of: you get
          directions to a beach, view a restaurant, book a stay. A blanket
          "Book" was wrong for a product that only books stays and deals. */}
      {reel.business_id ? (
        (() => {
          const cta = reelCta(reel.business_category);
          return (
            <Pressable
              testID={`reel-cta-${reel.reel_id}`}
              onPress={cta.kind === "directions" ? onDirections : onOpenBusiness}
              style={[reelStyles.bookBtn, { bottom: insets.bottom + 100 }]}
            >
              <Text style={reelStyles.bookText}>{cta.label}</Text>
              <Ionicons name={cta.icon} size={14} color={colors.onSurface} />
            </Pressable>
          );
        })()
      ) : null}
    </Pressable>
  );
}

function TopicChip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.topicChip, active && styles.topicChipActive]}
    >
      <Text style={[styles.topicText, active && styles.topicTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ReelAction({ icon, label, onPress, color, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={reelStyles.actionCol} hitSlop={6}>
      <View style={reelStyles.actionIcon}>
        <Ionicons name={icon} size={28} color={color ?? "#FFF"} />
      </View>
      <Text style={reelStyles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rails: {
    position: "absolute",
    left: 0,
    right: 0,
    maxHeight: 40,
    zIndex: 5,
  },
  railsInner: { paddingHorizontal: spacing.lg, gap: 8, alignItems: "center" },
  topicChip: {
    paddingHorizontal: 14,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  topicChipActive: { backgroundColor: "#FFF", borderColor: "#FFF" },
  topicText: { color: "#FFF", fontSize: tType.sm, fontFamily: fonts.bodyBold },
  topicTextActive: { color: colors.onSurface },

  container: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", gap: spacing.md },
  emptyTitle: { color: "#FFF", fontSize: 18, fontFamily: fonts.display, textAlign: "center" },
  emptySub: { color: "rgba(255,255,255,0.7)", fontSize: tType.base, textAlign: "center" },
  topBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { color: "#FFF", fontSize: 22, fontFamily: fonts.display, letterSpacing: -0.4, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 8 },
  cityBadge: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: fonts.bodyBold,
    paddingHorizontal: 10,
    height: 26,
    lineHeight: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
});

const reelStyles = StyleSheet.create({
  item: { backgroundColor: "#000", position: "relative" },
  videoBox: { ...(StyleSheet.absoluteFill as object), backgroundColor: "#000" },
  mutePill: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  mutePillText: { color: "#FFF", fontSize: 11, fontFamily: fonts.bodySemi },

  rail: {
    position: "absolute",
    right: spacing.md,
    gap: spacing.lg,
    alignItems: "center",
  },
  actionCol: { alignItems: "center", gap: 4 },
  actionIcon: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  actionLabel: { color: "#FFF", fontSize: 12, fontFamily: fonts.bodyBold, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },

  bottom: {
    position: "absolute",
    left: spacing.lg,
    right: 78,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
  },
  author: { color: "#FFF", fontSize: 15, fontFamily: fonts.bodyBold, marginBottom: 4 },
  caption: { color: "#FFF", fontSize: 15, lineHeight: 20, marginBottom: 10 },
  bizChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    maxWidth: "100%",
  },
  bizChipText: { color: "#FFF", fontSize: 12, fontFamily: fonts.bodyBold, flexShrink: 1 },

  bookBtn: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#FFF",
  },
  bookText: { color: colors.onSurface, fontSize: 14, fontFamily: fonts.bodyBold },
});
