import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Share,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, Business, InterestStatus } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { useAuth } from "@/src/auth";
import { placeUrl, shareContent } from "@/src/links";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type ReviewT = {
  review_id: string;
  user_name: string;
  rating: number;
  comment: string;
  created_at: string;
};

export default function BusinessDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { show } = useToast();
  const { user } = useAuth();
  const [biz, setBiz] = useState<Business | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [reviews, setReviews] = useState<ReviewT[]>([]);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState("");
  const [postingReview, setPostingReview] = useState(false);
  const [nearby, setNearby] = useState<Business[]>([]);
  const [interest, setInterest] = useState<InterestStatus | null>(null);
  const [savingInterest, setSavingInterest] = useState(false);
  // null while fine; "missing" when the place is gone; "error" for
  // anything transient, which is worth offering a retry for.
  const [loadFailure, setLoadFailure] = useState<null | "missing" | "error">(null);

  const loadReviews = useCallback(async () => {
    try {
      const rs = await api<ReviewT[]>(`/businesses/${id}/reviews`);
      setReviews(rs);
    } catch (e) { console.log("reviews", e); }
  }, [id]);

  const submitReview = async () => {
    if (!newComment.trim() || postingReview) return;
    setPostingReview(true);
    try {
      await api("/reviews", {
        method: "POST", auth: true,
        body: JSON.stringify({ business_id: id, rating: newRating, comment: newComment.trim() }),
      });
      setNewComment("");
      setNewRating(5);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show("Thanks — your review is live.", "success");
      await loadReviews();
    } catch (e: any) {
      show(
        e?.status === 401 ? "Sign in to leave a review."
          : e?.status === 429 ? "You're posting too quickly. Try again in a minute."
          : e?.message || "Couldn't post that review. Please try again.",
        "error"
      );
    } finally { setPostingReview(false); }
  };

  const share = async () => {
    if (!biz) return;
    try {
      const where = biz.area || biz.address || "";
      await Share.share(
        shareContent(
          where ? `${biz.name} — ${where}` : biz.name,
          placeUrl(biz.slug)
        )
      );
    } catch {
      show("Couldn't open sharing. Try again.", "error");
    }
  };

  /** Interested / Going / Visited. Tapping the active state clears it, and
   *  Visited is what puts the city on the journey map. */
  const flag = async (status: InterestStatus) => {
    if (!user) { router.push("/login"); return; }
    const prev = interest;
    const next = prev === status ? null : status;
    setInterest(next);
    setSavingInterest(true);
    try {
      if (next) {
        await api(`/places/${id}/interest`, {
          method: "PUT", auth: true, body: JSON.stringify({ status: next }),
        });
      } else {
        await api(`/places/${id}/interest`, { method: "DELETE", auth: true });
      }
    } catch (e: any) {
      setInterest(prev);
      show(e?.status === 401 ? "Sign in to save places." : "Couldn't save that.", "error");
    } finally {
      setSavingInterest(false);
    }
  };

  const load = useCallback(async () => {
    setLoadFailure(null);
    try {
      const [b, savedList, near, flag] = await Promise.all([
        api<Business>(`/businesses/${id}`),
        api<Business[]>("/saved", { auth: true }).catch(() => []),
        api<Business[]>(`/businesses/${id}/nearby?limit=3`).catch(() => []),
        api<{ status: InterestStatus | null }>(`/places/${id}/interest`, { auth: true })
          .catch(() => ({ status: null })),
      ]);
      setBiz(b);
      setSaved(savedList.some((s) => s.business_id === id));
      setNearby(near);
      setInterest(flag?.status ?? null);
    } catch (e: any) {
      console.log("business detail", e);
      // A 404 is a delisted or mistyped place and will not fix itself;
      // anything else is probably the network and is worth retrying.
      setLoadFailure(e?.status === 404 ? "missing" : "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); loadReviews(); }, [load, loadReviews]);

  const toggleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previous = saved;
    setSaved(!previous); // optimistic
    try {
      const r = await api<{ saved: boolean }>(`/saved/toggle`, {
        method: "POST", auth: true,
        body: JSON.stringify({ business_id: id }),
      });
      setSaved(r.saved);
    } catch (e: any) {
      setSaved(previous);
      show(e?.status === 401 ? "Sign in to save places." : "Couldn't save that. Please try again.", "error");
    }
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  // Without this the screen spun forever on a place that no longer exists.
  // That matters now place links are public and shareable: a link to a
  // delisted place used to hand the visitor a spinner that never resolved.
  if (!biz) {
    const missing = loadFailure !== "error";
    return (
      <View style={[styles.loader, { padding: spacing.xl, gap: spacing.md }]}>
        <Ionicons
          name={missing ? "compass-outline" : "cloud-offline-outline"}
          size={30}
          color={colors.onSurfaceTertiary}
        />
        <Text style={styles.gone} testID="place-unavailable">
          {missing
            ? "This place isn't on Explore91 anymore."
            : "Couldn't load this place."}
        </Text>
        <Text style={styles.goneSub}>
          {missing
            ? "It may have been removed, or the link may be out of date."
            : "Check your connection and try again."}
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          {!missing ? (
            <Pressable
              testID="place-retry"
              onPress={() => { setLoading(true); load(); }}
              style={styles.goneBtn}
            >
              <Text style={styles.goneBtnText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="place-explore"
            onPress={() => router.replace("/(tabs)/explore")}
            style={[styles.goneBtn, missing && styles.goneBtnPrimary]}
          >
            <Text style={[styles.goneBtnText, missing && styles.goneBtnTextPrimary]}>
              Explore nearby
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const width = Dimensions.get("window").width;
  const bookLabel = biz.booking_type === "appointment" ? "Book Appointment"
    : biz.booking_type === "instant" ? "Book Now" : "Reserve Table";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {/* Gallery */}
        <View style={{ height: 380 }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActiveImg(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {biz.gallery.map((uri, i) => (
              <Image key={i} source={{ uri }} style={{ width, height: 380 }} contentFit="cover" />
            ))}
          </ScrollView>
          <LinearGradient
            colors={["rgba(17,17,17,0.35)", "transparent"]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 120 }}
          />
          {/* Header buttons */}
          <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
            <Pressable testID="back-btn" style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color="#FFF" />
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="save-btn" style={styles.iconBtn} onPress={toggleSave}>
                <Ionicons name={saved ? "heart" : "heart-outline"} size={20} color={saved ? colors.brandTertiary : "#FFF"} />
              </Pressable>
              <Pressable testID="share-btn" style={styles.iconBtn} onPress={share}>
                <Ionicons name="share-outline" size={20} color="#FFF" />
              </Pressable>
            </View>
          </View>
          {/* dots */}
          <View style={styles.dots}>
            {biz.gallery.map((_, i) => (
              <View key={i} style={[styles.dot, i === activeImg && styles.dotActive]} />
            ))}
          </View>
        </View>

        {/* Info */}
        <View style={{ padding: spacing.lg }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm }}>
            {biz.tags.map((t) => (
              <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
            ))}
          </View>
          {/* The site leads with the area, then the name. `area` is optional;
              the seeded address already reads as one ("Grande Island"). */}
          <Text style={styles.areaKicker}>
            {(biz.area || biz.address || "").toUpperCase()}
          </Text>
          <Text style={styles.title} testID="business-name">{biz.name}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="star" size={14} color={colors.warning} />
            <Text style={styles.metaBold}>{biz.rating.toFixed(1)}</Text>
            <Text style={styles.metaLight}>  ({biz.review_count.toLocaleString()} reviews)</Text>
            <Text style={styles.dot2}>•</Text>
            <Text style={styles.metaLight}>{biz.price_range}</Text>
          </View>
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={16} color={colors.onSurfaceTertiary} />
            <Text style={styles.address}>{biz.address}</Text>
          </View>
          <View style={styles.addressRow}>
            <Ionicons name="time-outline" size={16} color={colors.onSurfaceTertiary} />
            <Text style={styles.address}>{biz.open_hours}</Text>
          </View>

          {/* WHY GO — one reason, the way the site frames a place. Falls back
              to the factual description until editorial copy exists. */}
          {biz.why_go || biz.description ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionKicker}>WHY GO</Text>
              <Text style={styles.desc}>{biz.why_go || biz.description}</Text>
            </View>
          ) : null}

          {/* ADD TO JOURNEY. This is what the site puts where a booking button
              would be — "No booking. Just a note for later." */}
          <View style={{ marginTop: spacing.xl }}>
            <Text style={styles.sectionKicker}>ADD TO JOURNEY</Text>
            <View style={styles.journeyRow}>
              {(["interested", "going", "visited"] as InterestStatus[]).map((s) => {
                const active = interest === s;
                return (
                  <Pressable
                    key={s}
                    testID={`interest-${s}`}
                    disabled={savingInterest}
                    onPress={() => flag(s)}
                    style={[styles.journeyBtn, active && styles.journeyBtnActive]}
                  >
                    <Ionicons
                      name={
                        s === "interested" ? (active ? "bookmark" : "bookmark-outline")
                        : s === "going" ? (active ? "checkmark-circle" : "checkmark-circle-outline")
                        : (active ? "flag" : "flag-outline")
                      }
                      size={15}
                      color={active ? "#FFF" : colors.onSurfaceSecondary}
                    />
                    <Text style={[styles.journeyBtnText, active && styles.journeyBtnTextActive]}>
                      {s === "interested" ? "Interested" : s === "going" ? "Going" : "Visited"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.journeyNote}>
              Marking a place visited adds its city to your journey.
            </Text>
          </View>

          {/* NEARBY */}
          {nearby.length > 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.sectionKicker}>NEARBY</Text>
              <Text style={styles.nearbyHead}>While you're here</Text>
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {nearby.map((n) => (
                  <Pressable
                    key={n.business_id}
                    testID={`nearby-${n.business_id}`}
                    onPress={() => router.push(`/business/${n.business_id}`)}
                    style={styles.nearbyRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nearbyCat}>{n.category.toUpperCase()}</Text>
                      <Text style={styles.nearbyName}>{n.name}</Text>
                      <Text style={styles.nearbyMeta}>{n.address}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Offers */}
          {biz.offers.length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.section}>Offers</Text>
              {biz.offers.map((o, i) => (
                <View key={i} style={styles.offerRow}>
                  <Ionicons name="pricetag" size={16} color={colors.brandTertiary} />
                  <Text style={styles.offerText}>{o}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Menu */}
          {biz.menu?.length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.section}>Menu highlights</Text>
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {biz.menu.map((m, i) => (
                  <View key={i} style={styles.menuRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.menuName}>{m.name}</Text>
                      <Text style={styles.menuPrice}>₹{m.price.toLocaleString()}</Text>
                    </View>
                    {m.image ? <Image source={{ uri: m.image }} style={styles.menuImg} contentFit="cover" /> : null}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Services */}
          {biz.services?.length > 0 && (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.section}>Services</Text>
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {biz.services.map((s, i) => (
                  <View key={i} style={styles.svcRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.menuName}>{s.name}</Text>
                      <Text style={styles.menuPrice}>{s.duration} · ₹{s.price.toLocaleString()}</Text>
                    </View>
                    <Pressable
                      testID={`svc-book-${i}`}
                      onPress={() => router.push({ pathname: "/book/[id]", params: { id: biz.business_id, service: s.name } })}
                      style={styles.svcBtn}
                    >
                      <Text style={styles.svcBtnText}>Book</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Reviews */}
          <View style={{ marginTop: spacing.xl }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={styles.section}>Reviews</Text>
              <Text style={styles.reviewCount}>{reviews.length} guest review{reviews.length === 1 ? "" : "s"}</Text>
            </View>

            {/* Compose */}
            <View style={styles.composer}>
              <Text style={styles.composerLabel}>Rate your experience</Text>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    testID={`star-${n}`}
                    onPress={() => setNewRating(n)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={n <= newRating ? "star" : "star-outline"}
                      size={28}
                      color={n <= newRating ? colors.warning : colors.borderStrong}
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                testID="review-input"
                value={newComment}
                onChangeText={setNewComment}
                placeholder="Share your experience…"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                style={styles.reviewInput}
              />
              <Pressable
                testID="review-submit"
                disabled={postingReview || !newComment.trim()}
                onPress={submitReview}
                style={[
                  styles.reviewSubmit,
                  (!newComment.trim() || postingReview) && { opacity: 0.5 },
                ]}
              >
                {postingReview ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.reviewSubmitText}>Post review</Text>
                )}
              </Pressable>
            </View>

            {/* List */}
            {reviews.length === 0 ? (
              <Text style={styles.emptyReview}>Be the first to leave a review.</Text>
            ) : (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                {reviews.map((r) => (
                  <View key={r.review_id} style={styles.reviewCard}>
                    <View style={styles.reviewHead}>
                      <View style={styles.reviewAvatar}>
                        <Text style={styles.reviewAvatarText}>
                          {(r.user_name?.[0] || "U").toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewName}>{r.user_name}</Text>
                        <View style={{ flexDirection: "row" }}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Ionicons
                              key={n}
                              name={n <= r.rating ? "star" : "star-outline"}
                              size={12}
                              color={n <= r.rating ? colors.warning : colors.borderStrong}
                            />
                          ))}
                        </View>
                      </View>
                      <Text style={styles.reviewDate}>
                        {new Date(r.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={styles.reviewText}>{r.comment}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Sticky booking bar */}
      <View style={[styles.bookBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bookPrice}>{biz.price_range} · {biz.category}</Text>
          <Text style={styles.bookHint}>Instant confirmation · Earn 50 points</Text>
        </View>
        <Pressable
          testID="book-now-button"
          onPress={() => router.push(`/book/${biz.business_id}`)}
          style={styles.bookBtn}
        >
          <Text style={styles.bookBtnText}>{bookLabel}</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gone: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  goneSub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  goneBtn: {
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  goneBtnPrimary: { backgroundColor: colors.brandTertiary },
  goneBtnText: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  goneBtnTextPrimary: { color: "#FFF" },

  areaKicker: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
    marginBottom: 4,
  },
  sectionKicker: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
    marginBottom: 6,
  },
  journeyRow: { flexDirection: "row", gap: 8 },
  journeyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  journeyBtnActive: { backgroundColor: colors.brandTertiary },
  journeyBtnText: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurfaceSecondary },
  journeyBtnTextActive: { color: "#FFF" },
  journeyNote: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 8 },
  nearbyHead: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  nearbyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  nearbyCat: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.onSurfaceTertiary,
  },
  nearbyName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface, marginTop: 2 },
  nearbyMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 1 },

  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  topBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(17,17,17,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { backgroundColor: "#FFF", width: 18 },

  tag: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  tagText: { fontSize: 11, color: colors.onSurfaceSecondary, fontWeight: "600" },

  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  metaBold: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface, marginLeft: 3 },
  metaLight: { fontSize: tType.base, color: colors.onSurfaceTertiary },
  dot2: { color: colors.onSurfaceTertiary, marginHorizontal: 6 },

  addressRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, gap: 6 },
  address: { fontSize: tType.base, color: colors.onSurfaceSecondary, flex: 1 },

  desc: { fontSize: tType.base, lineHeight: 22, color: colors.onSurfaceSecondary, marginTop: spacing.lg },

  section: { fontSize: tType.xl, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.3, marginBottom: spacing.sm },
  offerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  offerText: { fontSize: tType.base, color: colors.onSurface, fontWeight: "500" },

  menuRow: {
    flexDirection: "row",
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    alignItems: "center",
    gap: spacing.md,
  },
  menuName: { fontSize: tType.lg, fontWeight: "600", color: colors.onSurface },
  menuPrice: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  menuImg: { width: 56, height: 56, borderRadius: radius.md },

  svcRow: {
    flexDirection: "row",
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    alignItems: "center",
    gap: spacing.md,
  },
  svcBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  svcBtnText: { color: "#FFF", fontWeight: "700", fontSize: tType.sm },

  reviewCount: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontWeight: "600" },
  composer: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  composerLabel: { fontSize: tType.sm, fontWeight: "600", color: colors.onSurfaceTertiary, marginBottom: 8 },
  starRow: { flexDirection: "row", gap: 6 },
  reviewInput: {
    marginTop: spacing.md,
    minHeight: 80,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    fontSize: tType.base,
    textAlignVertical: "top",
  },
  reviewSubmit: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
  },
  reviewSubmitText: { color: "#FFF", fontSize: tType.base, fontWeight: "700" },
  emptyReview: { marginTop: spacing.md, color: colors.onSurfaceTertiary, fontSize: tType.base },
  reviewCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  reviewAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  reviewAvatarText: { color: "#FFF", fontWeight: "700", fontSize: tType.sm },
  reviewName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  reviewDate: { fontSize: 11, color: colors.onSurfaceTertiary },
  reviewText: { fontSize: tType.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm, lineHeight: 20 },

  bookBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  bookPrice: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  bookHint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  bookBtn: {
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  bookBtnText: { color: "#FFF", fontSize: tType.lg, fontWeight: "700" },
});
