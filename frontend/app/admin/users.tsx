import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { Image } from "expo-image";
import { api, UserT } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty } from "@/src/components/admin/ui";

type UserRow = UserT & { is_blocked?: boolean };

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api<UserRow[]>("/admin/users", { auth: true });
      setUsers(list);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = q
    ? users.filter((u) => (u.name + " " + u.email).toLowerCase().includes(q.toLowerCase()))
    : users;

  const toggleBlock = async (id: string) => {
    try {
      await api(`/admin/users/${id}/block`, { method: "PATCH", auth: true });
      await load();
    } catch (e) { console.log(e); }
  };

  return (
    <View>
      <PageHeader
        title="Users"
        subtitle={`${users.length} total accounts`}
        right={
          <TextInput
            placeholder="Search name or email"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={q}
            onChangeText={setQ}
            style={styles.search}
          />
        }
      />

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Table>
          <TableHead
            cols={[
              { label: "User", width: 3 },
              { label: "Roles", width: 2 },
              { label: "Wallet", width: 1 },
              { label: "Status", width: 1 },
              { label: "Actions", width: 1.5 },
            ]}
          />
          {filtered.length === 0 ? (
            <Empty label="No matching users." />
          ) : (
            filtered.map((u) => (
              <TableRow key={u.user_id}>
                <Cell width={3}>
                  <View style={styles.userCell}>
                    <View style={styles.avatar}>
                      {u.picture ? (
                        <Image source={{ uri: u.picture }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                      ) : (
                        <Text style={styles.avatarText}>{u.name[0]?.toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName} numberOfLines={1}>{u.name}</Text>
                      <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
                    </View>
                  </View>
                </Cell>
                <Cell width={2}>
                  <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                    {(u.roles ?? ["customer"]).map((r) => (
                      <Pill key={r} label={r} tone={r === "admin" ? "brand" : r === "owner" ? "ok" : "neutral"} />
                    ))}
                  </View>
                </Cell>
                <Cell width={1}>{`${u.wallet_points ?? 0} pts`}</Cell>
                <Cell width={1}>
                  <Pill label={u.is_blocked ? "Blocked" : "Active"} tone={u.is_blocked ? "err" : "ok"} />
                </Cell>
                <Cell width={1.5}>
                  <Btn
                    testID={`block-${u.user_id}`}
                    small
                    tone={u.is_blocked ? "success" : "danger"}
                    label={u.is_blocked ? "Unblock" : "Block"}
                    onPress={() => toggleBlock(u.user_id)}
                  />
                </Cell>
              </TableRow>
            ))
          )}
        </Table>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    width: 280, height: 40, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: 16, color: colors.onSurface, fontSize: tType.base,
  },
  userCell: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#FFF", fontWeight: "700" },
  userName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  userEmail: { fontSize: tType.sm, color: colors.onSurfaceTertiary },
});
