import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type ToastKind = "error" | "success" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<{ show: (text: string, kind?: ToastKind) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((text: string, kind: ToastKind = "error") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3000);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <View style={styles.host} pointerEvents="box-none">
        {items.map((t) => (
          <Pressable
            key={t.id}
            testID={`toast-${t.kind}`}
            onPress={() => dismiss(t.id)}
            style={[styles.toast, styles[t.kind]]}
          >
            <Ionicons
              name={
                t.kind === "error"
                  ? "alert-circle"
                  : t.kind === "success"
                  ? "checkmark-circle"
                  : "information-circle"
              }
              size={18}
              color="#FFF"
            />
            <Text style={styles.toastText}>{t.text}</Text>
            <Ionicons name="close" size={14} color="rgba(255,255,255,0.7)" />
          </Pressable>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}

/** Runs an admin action with a per-row busy key, surfacing failures as toasts.
 *  A busy action ignores repeat presses, so double-clicking Approve can't fire twice. */
export function useAsyncAction() {
  const { show } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
      if (busyKey) return;
      setBusyKey(key);
      try {
        await fn();
        if (successMsg) show(successMsg, "success");
      } catch (e: any) {
        show(e?.message || "Something went wrong. Please try again.", "error");
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, show]
  );

  return { run, busyKey, isBusy: (key: string) => busyKey === key };
}

const styles = StyleSheet.create({
  host: {
    position: "fixed" as any,
    right: 24,
    bottom: 24,
    gap: 8,
    zIndex: 9999,
    maxWidth: 420,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  error: { backgroundColor: colors.error },
  success: { backgroundColor: colors.success },
  info: { backgroundColor: colors.brandSecondary },
  toastText: { color: "#FFF", fontSize: tType.sm, fontWeight: "600", flex: 1 },
});
