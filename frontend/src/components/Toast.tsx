import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type ToastKind = "error" | "success";
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<{ show: (text: string, kind?: ToastKind) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((text: string, kind: ToastKind = "error") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 5000 : 3000);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <View
        style={[styles.host, { bottom: insets.bottom + 96 }]}
        pointerEvents="box-none"
      >
        {items.map((t) => (
          <Pressable
            key={t.id}
            testID={`toast-${t.kind}`}
            onPress={() => dismiss(t.id)}
            style={[styles.toast, t.kind === "error" ? styles.error : styles.success]}
          >
            <Ionicons
              name={t.kind === "error" ? "alert-circle" : "checkmark-circle"}
              size={18}
              color="#FFF"
            />
            <Text style={styles.text}>{t.text}</Text>
          </Pressable>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}

/** Runs an action, surfacing failure instead of swallowing it.
 *  Returns true when the action succeeded, so callers can branch. */
export function useAction() {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>, opts?: { success?: string; failure?: string }) => {
      if (busy) return false;
      setBusy(true);
      try {
        await fn();
        if (opts?.success) show(opts.success, "success");
        return true;
      } catch (e: any) {
        const offline = e?.message === "Failed to fetch" || e?.message === "Network request failed";
        show(
          offline
            ? "Can't reach Explore91. Check your connection and try again."
            : opts?.failure || e?.message || "Something went wrong. Please try again.",
          "error"
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, show]
  );

  return { run, busy };
}

const styles = StyleSheet.create({
  host: {
    position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  error: { backgroundColor: colors.error },
  success: { backgroundColor: colors.success },
  text: { color: "#FFF", fontSize: tType.sm, fontWeight: "600", flex: 1, lineHeight: 19 },
});
