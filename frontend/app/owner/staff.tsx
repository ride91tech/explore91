import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { api, Business } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type Staff = { staff_id: string; business_id: string; name: string; role: string };

const ROLES = ["Manager", "Chef", "Server", "Receptionist", "Therapist"];

export default function OwnerStaff() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("Manager");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api<Staff[]>("/owner/staff", { auth: true }),
        api<Business[]>("/owner/businesses", { auth: true }),
      ]);
      setStaff(s);
      setBusinesses(b);
      if (!businessId && b[0]) setBusinessId(b[0].business_id);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!name.trim() || !businessId) return;
    setAdding(true);
    try {
      await api("/owner/staff", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ name: name.trim(), role, business_id: businessId }),
      });
      setName("");
      await load();
    } catch (e) {
      console.log(e);
    } finally {
      setAdding(false);
    }
  };

  const del = async (id: string) => {
    try {
      await api(`/owner/staff/${id}`, { method: "DELETE", auth: true });
      await load();
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <View style={{ gap: spacing.xl }}>
      <View>
        <Text style={styles.eyebrow}>YOUR TEAM</Text>
        <Text style={styles.h1}>Staff</Text>
        <Text style={styles.sub}>Assign teammates to each of your businesses.</Text>
      </View>

      {/* Add form */}
      <View style={styles.form}>
        <Text style={styles.formTitle}>Add a team member</Text>

        <Text style={styles.label}>Assign to business</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        >
          {businesses.map((b) => {
            const active = businessId === b.business_id;
            return (
              <Pressable
                key={b.business_id}
                testID={`staff-biz-${b.business_id}`}
                onPress={() => setBusinessId(b.business_id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                  numberOfLines={1}
                >
                  {b.name}
                </Text>
              </Pressable>
            );
          })}
          {businesses.length === 0 && (
            <Text style={{ color: colors.onSurfaceTertiary }}>Create a business first.</Text>
          )}
        </ScrollView>

        <View style={styles.formRow}>
          <View style={{ flex: 2, minWidth: 220 }}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              testID="staff-name"
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
            />
          </View>
          <View style={{ flex: 3, minWidth: 220 }}>
            <Text style={styles.label}>Role</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  testID={`staff-role-${r.toLowerCase()}`}
                  onPress={() => setRole(r)}
                  style={[styles.chip, role === r && styles.chipActive]}
                >
                  <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <Pressable
          testID="staff-add"
          disabled={!name.trim() || !businessId || adding}
          onPress={add}
          style={[styles.addBtn, (!name.trim() || !businessId) && { opacity: 0.5 }]}
        >
          {adding ? <ActivityIndicator color="#FFF" /> : <Text style={styles.addBtnText}>Add to team</Text>}
        </Pressable>
      </View>

      <View>
        <Text style={styles.section}>Your team</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />
        ) : staff.length === 0 ? (
          <Text style={styles.emptyText}>No staff added yet.</Text>
        ) : (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {staff.map((s) => (
              <View key={s.staff_id} style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{s.name[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.name}</Text>
                  <Text style={styles.meta}>{s.role}</Text>
                </View>
                <Pressable
                  testID={`staff-del-${s.staff_id}`}
                  onPress={() => del(s.staff_id)}
                  hitSlop={10}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary, letterSpacing: 2, textTransform: "uppercase" },
  h1: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6, marginTop: 4 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  form: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  formTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  formRow: { flexDirection: "row", flexWrap: "wrap" as any, gap: spacing.lg },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.onSurfaceTertiary,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: spacing.lg,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 14,
    color: colors.onSurface,
    fontSize: tType.base,
  } as any,
  chip: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: tType.sm, fontWeight: "600", color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  addBtn: {
    marginTop: spacing.xl,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 24,
  },
  addBtnText: { color: "#FFF", fontSize: tType.base, fontWeight: "700" },

  section: { fontSize: tType.xl, fontWeight: "700", color: colors.onSurface },
  row: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  name: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  emptyText: { color: colors.onSurfaceTertiary, marginTop: spacing.md, fontSize: tType.base },
});
