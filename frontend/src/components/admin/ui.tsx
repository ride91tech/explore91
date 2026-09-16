import React from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
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
      <View style={styles.headerTitles}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
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
  busy,
}: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "danger" | "success";
  icon?: React.ReactNode;
  testID?: string;
  disabled?: boolean;
  small?: boolean;
  busy?: boolean;
}) {
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.surfaceSecondary,
    danger: colors.error,
    success: colors.success,
  }[tone];
  const fg = tone === "secondary" ? colors.onSurface : "#FFF";
  const blocked = disabled || busy;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!busy }}
      style={[
        styles.btn,
        { backgroundColor: bg, opacity: blocked ? 0.5 : 1, height: small ? 30 : 38 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon}
      <Text style={[styles.btnLabel, { color: fg, fontSize: small ? tType.sm : tType.base }]}>{label}</Text>
    </Pressable>
  );
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search",
  width = 260,
  testID,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  width?: number;
  testID?: string;
}) {
  return (
    <View style={[styles.searchWrap, { width }]}>
      <Ionicons name="search" size={15} color={colors.onSurfaceTertiary} />
      <TextInput
        testID={testID}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        value={value}
        onChangeText={onChangeText}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={15} color={colors.onSurfaceTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Honest row count — never let a truncated page look like the whole dataset. */
export function ResultCount({ shown, total }: { shown: number; total: number }) {
  if (total === 0) return null;
  return (
    <Text style={styles.count}>
      {shown < total ? `Showing ${shown} of ${total.toLocaleString()}` : `${total.toLocaleString()} total`}
    </Text>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (nextOffset: number) => void;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <View style={styles.pager}>
      <Btn
        testID="page-prev"
        small
        tone="secondary"
        label="Previous"
        disabled={offset === 0}
        onPress={() => onChange(Math.max(0, offset - limit))}
      />
      <Text style={styles.pagerText}>Page {page} of {pages}</Text>
      <Btn
        testID="page-next"
        small
        tone="secondary"
        label="Next"
        disabled={page >= pages}
        onPress={() => onChange(offset + limit)}
      />
    </View>
  );
}

/** Distinguishes "still loading" from "loaded and genuinely empty". */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.brandPrimary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
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
  // Wraps instead of crushing the title when the controls are wide / window is narrow.
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 24,
    gap: spacing.md,
  },
  headerTitles: { flexGrow: 1, flexShrink: 1, minWidth: 220 },
  headerRight: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 },
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

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.onSurface,
    fontSize: tType.base,
    outlineStyle: "none",
  } as any,

  count: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginBottom: 8 },

  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  pagerText: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontWeight: "600" },

  loading: { flexDirection: "row", alignItems: "center", gap: 10, padding: 24 },
  loadingText: { fontSize: tType.base, color: colors.onSurfaceTertiary },
});
