import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius, spacing, type as tType } from "@/src/theme";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: any) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function KPI({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" | "err" | "brand" }) {
  const bg = {
    neutral: colors.surfaceTertiary,
    ok: colors.success,
    warn: colors.warning,
    err: colors.error,
    brand: colors.brandTertiary,
  }[tone];
  const fg = tone === "neutral" ? colors.onSurface : "#FFF";
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Btn({
  label,
  onPress,
  tone = "primary",
  icon,
  testID,
  disabled,
  small,
}: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "danger" | "success";
  icon?: React.ReactNode;
  testID?: string;
  disabled?: boolean;
  small?: boolean;
}) {
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.surfaceSecondary,
    danger: colors.error,
    success: colors.success,
  }[tone];
  const fg = tone === "secondary" ? colors.onSurface : "#FFF";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, height: small ? 30 : 38 },
      ]}
    >
      {icon}
      <Text style={[styles.btnLabel, { color: fg, fontSize: small ? tType.sm : tType.base }]}>{label}</Text>
    </Pressable>
  );
}

export function Table({ children }: any) {
  return <View style={styles.table}>{children}</View>;
}

export function TableHead({ cols }: { cols: { label: string; width?: number | string }[] }) {
  return (
    <View style={styles.tHead}>
      {cols.map((c, i) => (
        <Text key={i} style={[styles.th, { flex: (c.width as any) || 1 }]} numberOfLines={1}>
          {c.label}
        </Text>
      ))}
    </View>
  );
}

export function TableRow({ children }: any) {
  return <View style={styles.tRow}>{children}</View>;
}

export function Cell({ children, width, style }: any) {
  return (
    <View style={[{ flex: width || 1, justifyContent: "center" }, style]}>
      {typeof children === "string" ? <Text style={styles.tCell} numberOfLines={2}>{children}</Text> : children}
    </View>
  );
}

export function Empty({ label = "Nothing here yet." }: { label?: string }) {
  return <Text style={styles.empty}>{label}</Text>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", marginBottom: 24, gap: spacing.md },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.lg,
  },

  kpi: {
    flex: 1,
    minWidth: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.lg,
  },
  kpiLabel: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  kpiValue: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  kpiHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },

  pill: { paddingHorizontal: 10, height: 22, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 11, fontWeight: "700" },

  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 14, gap: 6, borderRadius: radius.pill,
  },
  btnLabel: { fontWeight: "700" },

  table: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: "hidden",
  },
  tHead: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  th: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1 },
  tRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
    alignItems: "center",
  },
  tCell: { fontSize: tType.sm, color: colors.onSurface },
  empty: { fontSize: tType.base, color: colors.onSurfaceTertiary, padding: 24, textAlign: "center" },
});
