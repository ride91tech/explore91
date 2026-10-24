import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { apiPaged, api, UserT } from "@/src/api";
import { colors, fonts, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty,
  SearchInput, Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type UserRow = UserT & { is_blocked?: boolean };

const PAGE = 25;

export default function Users() {
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q.trim()) params.append("q", q.trim());
    const res = await apiPaged<UserRow>(`/admin/users?${params}`, { auth: true });
    setRows(res.rows);
    setTotal(res.total);
  }, [q, offset]);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      run("load", load).finally(() => setLoading(false));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { setOffset(0); }, [q]);

  const toggleBlock = (u: UserRow) => {
    const blocking = !u.is_blocked;
    if (blocking && typeof window !== "undefined" &&
        !window.confirm(`Block ${u.email}?\n\nThey will be signed out of every device immediately and cannot use the app until unblocked.`)) {
      return;
    }
    run(
      u.user_id,
      async () => {
        await api(`/admin/users/${u.user_id}/block`, { method: "PATCH", auth: true });
        await load();
      },
      blocking ? `${u.email} blocked and signed out.` : `${u.email} unblocked.`
    );
  };

  const flag = (u: UserRow) =>
    router.push(`/admin/flags?entity_type=user&entity_id=${u.user_id}` as any);

  return (
    <View>
      <PageHeader
        title="Users"
        subtitle="Search every account, block abuse, escalate to a fraud flag."
        right={
          <SearchInput
            testID="users-search"
            value={q}
            onChangeText={setQ}
            placeholder="Search name or email…"
            width={280}
          />
        }
      />

      {loading ? (
        <Loading label="Loading users…" />
      ) : (
        <>
          <ResultCount shown={rows.length} total={total} />
          <Table>
            <TableHead
              cols={[
                { label: "User", width: 3 },
                { label: "Roles", width: 2 },
                { label: "Wallet", width: 1 },
                { label: "Status", width: 1 },
                { label: "Actions", width: 2 },
              ]}
            />
            {rows.length === 0 ? (
              <Empty label={q ? `No users match "${q}".` : "No accounts yet."} />
            ) : (
              rows.map((u) => (
                <TableRow key={u.user_id}>
                  <Cell width={3}>
                    <View style={styles.userCell}>
                      <View style={styles.avatar}>
                        {u.picture ? (
                          <Image source={{ uri: u.picture }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                        ) : (
                          <Text style={styles.avatarText}>{u.name?.[0]?.toUpperCase() ?? "?"}</Text>
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
                  <Cell width={2}>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      <Btn
                        testID={`block-${u.user_id}`}
                        small
                        tone={u.is_blocked ? "success" : "danger"}
                        label={u.is_blocked ? "Unblock" : "Block"}
                        busy={isBusy(u.user_id)}
                        onPress={() => toggleBlock(u)}
                      />
                      <Btn
                        testID={`flag-${u.user_id}`}
                        small
                        tone="secondary"
                        label="Flag"
                        onPress={() => flag(u)}
                      />
                    </View>
                  </Cell>
                </TableRow>
              ))
            )}
          </Table>
          <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  userCell: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#FFF", fontFamily: fonts.bodyBold },
  userName: { fontSize: tType.base, fontFamily: fonts.bodyBold, color: colors.onSurface },
  userEmail: { fontSize: tType.sm, color: colors.onSurfaceTertiary },
});
