/**
 * One way to share, everywhere.
 *
 * On a phone, the OS share sheet is the right answer: it already lists
 * WhatsApp and whatever else the person uses. On the web, react-native-web's
 * `Share.share` maps to `navigator.share`, which desktop browsers mostly lack,
 * so every Share tap on a laptop ended in "Couldn't open sharing". There, this
 * shows its own sheet with WhatsApp — where Indian trip planning actually
 * happens — and Copy link.
 */
import React, { createContext, useCallback, useContext, useState } from "react";
import { Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { shareContent } from "@/src/links";
import { useToast } from "@/src/components/Toast";
import { colors, fonts, radius, shadow, spacing, type as tType } from "@/src/theme";

type Payload = { text: string; url: string | null };

const ShareCtx = createContext<(text: string, url: string | null) => Promise<void>>(
  async () => {}
);

/** `share(text, url)`. Failures are reported with a toast, never thrown. */
export function useShare() {
  return useContext(ShareCtx);
}

export function whatsappUrl(text: string, url: string | null): string {
  return `https://wa.me/?text=${encodeURIComponent(url ? `${text}\n${url}` : text)}`;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function ShareHost({ children }: { children: React.ReactNode }) {
  const { show } = useToast();
  const [sheet, setSheet] = useState<Payload | null>(null);

  const share = useCallback(async (text: string, url: string | null) => {
    if (Platform.OS !== "web") {
      try {
        await Share.share(shareContent(text, url));
      } catch {
        show("Couldn't open sharing. Try again.", "error");
      }
      return;
    }
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (nav?.share) {
      try {
        await nav.share(url ? { text, url } : { text });
        return;
      } catch (e: any) {
        // Dismissing the browser's sheet is a choice, not a failure.
        if (e?.name === "AbortError") return;
        // Anything else (no permission, unsupported payload): fall through.
      }
    }
    setSheet({ text, url });
  }, [show]);

  const close = () => setSheet(null);

  const openWhatsApp = async () => {
    if (!sheet) return;
    const link = whatsappUrl(sheet.text, sheet.url);
    close();
    try {
      await Linking.openURL(link);
    } catch {
      show("Couldn't open WhatsApp.", "error");
    }
  };

  const copy = async () => {
    if (!sheet) return;
    const ok = await copyToClipboard(sheet.url ?? sheet.text);
    close();
    if (ok) show("Link copied", "success");
    else show("Couldn't copy the link.", "error");
  };

  return (
    <ShareCtx.Provider value={share}>
      {children}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="share-sheet">
            <View style={styles.grabber} />
            <View style={styles.titleRow}>
              <Text style={styles.title}>Share</Text>
              <Pressable testID="share-close" onPress={close} style={styles.close} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.onSurface} />
              </Pressable>
            </View>

            {sheet ? (
              <View style={styles.preview}>
                <Text style={styles.previewText} numberOfLines={2}>{sheet.text}</Text>
                {sheet.url ? (
                  <Text style={styles.previewUrl} numberOfLines={1}>
                    {sheet.url.replace(/^https?:\/\//, "")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.options}>
              <Option
                testID="share-whatsapp"
                icon="logo-whatsapp"
                label="WhatsApp"
                tint="#25D366"
                onPress={openWhatsApp}
              />
              <Option
                testID="share-copy"
                icon={sheet?.url ? "link-outline" : "copy-outline"}
                label={sheet?.url ? "Copy link" : "Copy text"}
                onPress={copy}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ShareCtx.Provider>
  );
}

function Option({
  icon,
  label,
  tint,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  tint?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.option} accessibilityRole="button">
      <View style={[styles.optionIcon, tint ? { backgroundColor: tint } : null]}>
        <Ionicons name={icon} size={22} color={tint ? "#FFF" : colors.onSurface} />
      </View>
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(14,22,15,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    ...shadow.float,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: tType.xl, color: colors.onSurface, letterSpacing: -0.5 },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  previewText: { fontFamily: fonts.bodyBold, fontSize: tType.base, color: colors.onSurface },
  previewUrl: { fontSize: tType.sm, color: colors.onSurfaceSecondary },
  options: { flexDirection: "row", justifyContent: "space-around", marginTop: spacing.lg },
  option: { alignItems: "center", gap: spacing.xs, minWidth: 88 },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLabel: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.onSurface },
});
