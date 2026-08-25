import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Check, ChevronRight, RotateCcw, Search } from "lucide-react-native";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  defaultPermissionsForRole,
  type MasterPermissions,
  type PermissionGroupKey,
} from "@babun/shared/local/masters";
import {
  PRESETS,
  detectPreset,
  normalizeLabel,
  permissionsEqual,
  type PresetId,
} from "@babun/shared/local/master-presets";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useMaster, useTeams } from "@/features/reference/queries";
import {
  getMasterPermissions,
  getMasterRole,
  useUpdateMasterProfile,
} from "@/features/reference/master-profile";

type VisibilityMode = "own" | "picked" | "all";

// ─── Global master access (web parity: masters/[id]/access/page.tsx) ──
// Owns the master's GLOBAL permission matrix (PERMISSION_GROUPS ×
// PERMISSION_LABELS) plus team visibility (visible_team_ids). Stored inside
// masters.profile.permissions; read through getMasterPermissions (which layers
// mergePermissions over the role baseline — RISK-4: a legacy master with no
// saved flags must not read as "everything off"). Presets from the shared
// master-presets module apply the exact same shapes as web.
//
// Permission writes replace one top-level `permissions` object. A local mutex
// keeps a second toggle from being built on a stale snapshot while the first
// save + authoritative refetch is still pending.

export default function MasterAccessScreen() {
  const t = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const masterQuery = useMaster(id);
  const teamsQuery = useTeams();
  const { data: master } = masterQuery;
  const teams = teamsQuery.data ?? [];
  const save = useUpdateMasterProfile();
  const writeLocked = useRef(false);

  const role = master ? getMasterRole(master) : "helper";
  const permissions: MasterPermissions = useMemo(
    () => (master ? getMasterPermissions(master) : defaultPermissionsForRole("helper")),
    [master],
  );

  const currentVisibility: VisibilityMode = useMemo(() => {
    const v = permissions.visible_team_ids ?? [];
    if (v.includes("*")) return "all";
    if (v.length === 0) return "own";
    return "picked";
  }, [permissions.visible_team_ids]);

  const activePreset: PresetId = useMemo(
    () => detectPreset(permissions),
    [permissions],
  );

  // First group open by default; the rest collapsed (web parity defaultGroupsOpen).
  const [groupsOpen, setGroupsOpen] = useState<Record<PermissionGroupKey, boolean>>(
    () => {
      const out = {} as Record<PermissionGroupKey, boolean>;
      PERMISSION_GROUPS.forEach((g, i) => {
        out[g.key] = i === 0;
      });
      return out;
    },
  );
  const [query, setQuery] = useState("");

  if (masterQuery.isLoading || teamsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступы" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  const readError = masterQuery.error || teamsQuery.error;
  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступы" />
        <EmptyState
          state="error"
          title="Не удалось загрузить доступы"
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([masterQuery.refetch(), teamsQuery.refetch()]),
          }}
          fill
        />
      </Screen>
    );
  }
  if (!master) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступы" />
        <EmptyState title="Мастер не найден" fill />
      </Screen>
    );
  }
  const m = master;

  // Single patch — top-level `permissions` replaces (read-before-write merges
  // the rest of the profile). visible_team_ids rides inside permissions.
  const persistPermissions = (next: MasterPermissions) => {
    if (writeLocked.current) return;
    writeLocked.current = true;
    save.mutate(
      { id: m.id, patch: { permissions: next } },
      {
        onError: (error) =>
          Alert.alert(
            "Не удалось сохранить доступы",
            error.message || "Проверьте соединение и повторите попытку.",
          ),
        onSettled: () => {
          writeLocked.current = false;
        },
      },
    );
  };

  const commit = (diff: Partial<MasterPermissions>) => {
    persistPermissions({ ...permissions, ...diff });
  };

  const applyPreset = (preset: Exclude<PresetId, "custom">) => {
    const built = PRESETS.find((p) => p.id === preset);
    if (!built) return;
    const next = built.build();
    if (permissionsEqual(permissions, next)) return;
    persistPermissions(next);
  };

  const togglePermission = (key: keyof MasterPermissions) => {
    if (key === "visible_team_ids") return;
    commit({ [key]: !permissions[key] } as Partial<MasterPermissions>);
  };

  const setVisibility = (next: VisibilityMode) => {
    if (next === currentVisibility) return;
    if (next === "own") commit({ visible_team_ids: [] });
    else if (next === "all") commit({ visible_team_ids: ["*"] });
    else {
      // "picked" — seed with the master's own team if any.
      commit({ visible_team_ids: m.team_id ? [m.team_id] : [] });
    }
  };

  const toggleVisibleTeam = (teamId: string) => {
    const arr = permissions.visible_team_ids ?? [];
    const next = arr.includes(teamId)
      ? arr.filter((x) => x !== teamId)
      : [...arr, teamId];
    commit({ visible_team_ids: next });
  };

  const resetToDefaults = () => {
    persistPermissions(defaultPermissionsForRole(role));
  };

  const toggleGroup = (key: PermissionGroupKey) =>
    setGroupsOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const activeTeams = teams.filter((tm) => tm.is_active !== false);

  const normalizedQuery = normalizeLabel(query.trim());
  const searchActive = normalizedQuery.length > 0;

  const filteredGroups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: searchActive
      ? group.permissions.filter((p) =>
          normalizeLabel(PERMISSION_LABELS[p]).includes(normalizedQuery),
        )
      : group.permissions,
  })).filter((g) => g.permissions.length > 0);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Доступы" subtitle={m.full_name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* ── Пресеты ──────────────────────────────────────────── */}
        <SectionCard title="Шаблоны прав" padded>
          <View className="flex-row flex-wrap gap-2">
            {PRESETS.map((p) => {
              const picked = activePreset === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => applyPreset(p.id)}
                  disabled={save.isPending}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked, disabled: save.isPending }}
                  accessibilityLabel={p.label}
                  style={{
                    height: 36,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: picked ? t.accent : t.fill,
                  }}
                  className="active:opacity-70"
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "600",
                      color: picked ? "#fff" : t.ink,
                    }}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
            {activePreset === "custom" ? (
              <View
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${t.accent}22`,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  Кастомные
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontSize: 12, color: t.faint, marginTop: 10, lineHeight: 16 }}>
            Быстрый набор: один тап вместо тридцати тумблеров.
          </Text>
        </SectionCard>

        {/* ── Видимость команд ──────────────────────────────────── */}
        <SectionCard title="Видимость команд">
          {(
            [
              { v: "own", label: "Только своя команда" },
              { v: "picked", label: "Выбранные команды" },
              { v: "all", label: "Все команды" },
            ] as const
          ).map((opt, i, arr) => {
            const picked = currentVisibility === opt.v;
            return (
              <View key={opt.v}>
                {i > 0 ? <Divider inset={16} /> : null}
                <Pressable
                  onPress={() => setVisibility(opt.v)}
                  disabled={save.isPending}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked, disabled: save.isPending }}
                  accessibilityLabel={opt.label}
                  className="min-h-[48px] flex-row items-center justify-between px-4 active:opacity-70"
                >
                  <Text
                    style={{
                      fontSize: 15,
                      color: picked ? t.accent : t.ink,
                      fontWeight: picked ? "600" : "400",
                    }}
                  >
                    {opt.label}
                  </Text>
                  {picked ? <Check color={t.accent} size={ICON.sm} /> : null}
                </Pressable>
              </View>
            );
          })}
        </SectionCard>

        {currentVisibility === "picked" ? (
          <SectionCard title="Какие команды видит">
            {activeTeams.length === 0 ? (
              <View className="px-4 py-4">
                <Text style={{ fontSize: 13, color: t.faint, textAlign: "center" }}>
                  Нет активных команд.
                </Text>
              </View>
            ) : (
              activeTeams.map((tm, i) => {
                const picked = (permissions.visible_team_ids ?? []).includes(tm.id);
                return (
                  <View key={tm.id}>
                    {i > 0 ? <Divider inset={44} /> : null}
                    <View className="min-h-[48px] flex-row items-center px-4">
                      <View
                        className="mr-3 h-6 w-6 rounded-full"
                        style={{ backgroundColor: tm.color ?? t.faint }}
                      />
                      <Text
                        style={{ flex: 1, fontSize: 15, color: t.ink }}
                        numberOfLines={1}
                      >
                        {tm.name}
                      </Text>
                      <Switch
                        value={picked}
                        onValueChange={() => toggleVisibleTeam(tm.id)}
                        disabled={save.isPending}
                        trackColor={{ true: t.accent }}
                        accessibilityLabel={tm.name}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </SectionCard>
        ) : null}

        {/* ── Поиск по правам ───────────────────────────────────── */}
        <View className="mx-3 mt-4">
          <View
            className="flex-row items-center rounded-[10px] px-3"
            style={{ backgroundColor: t.fill }}
          >
            <Search color={t.faint} size={ICON.sm} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Найти право…"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Поиск по правам доступа"
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 8,
                fontSize: 15,
                color: t.ink,
              }}
            />
          </View>
        </View>

        {/* ── Права по группам (collapsible) ────────────────────── */}
        {filteredGroups.map((group) => {
          const expanded = searchActive ? true : groupsOpen[group.key];
          return (
            <View key={group.key} className="mt-4">
              <Pressable
                onPress={() => !searchActive && toggleGroup(group.key)}
                disabled={searchActive}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={group.title}
                className="flex-row items-center justify-between px-5 pb-1.5 active:opacity-60"
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: t.faint,
                  }}
                >
                  {group.title}
                </Text>
                {!searchActive ? (
                  <ChevronRight
                    color={t.faint}
                    size={ICON.xs}
                    style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
                  />
                ) : null}
              </Pressable>
              {expanded ? (
                <>
                  <SectionCard className="mt-0">
                    {group.permissions.map((p, i) => (
                      <View key={p}>
                        {i > 0 ? <Divider inset={16} /> : null}
                        <View className="min-h-[48px] flex-row items-center px-4 py-2">
                          <Text
                            style={{
                              flex: 1,
                              fontSize: 15,
                              color: t.ink,
                              lineHeight: 20,
                              paddingRight: 12,
                            }}
                          >
                            {PERMISSION_LABELS[p]}
                          </Text>
                          <Switch
                            value={Boolean(permissions[p as keyof MasterPermissions])}
                            onValueChange={() =>
                              togglePermission(p as keyof MasterPermissions)
                            }
                            disabled={save.isPending}
                            trackColor={{ true: t.accent }}
                            accessibilityLabel={PERMISSION_LABELS[p]}
                          />
                        </View>
                      </View>
                    ))}
                  </SectionCard>
                  {group.description ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: t.faint,
                        lineHeight: 16,
                        paddingHorizontal: 20,
                        paddingTop: 8,
                      }}
                    >
                      {group.description}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}

        {searchActive && filteredGroups.length === 0 ? (
          <SectionCard>
            <View className="px-4 py-6">
              <Text style={{ fontSize: 13, color: t.faint, textAlign: "center" }}>
                По запросу «{query}» прав не найдено.
              </Text>
            </View>
          </SectionCard>
        ) : null}

        {/* ── Сброс ─────────────────────────────────────────────── */}
        <SectionCard className="mt-5">
          <Pressable
            onPress={resetToDefaults}
            disabled={save.isPending}
            accessibilityRole="button"
            accessibilityLabel="Сбросить на стандартные для роли"
            accessibilityState={{ disabled: save.isPending }}
            className="min-h-[48px] flex-row items-center justify-center gap-2 px-4 active:opacity-70"
          >
            <RotateCcw color={t.accent} size={ICON.sm} />
            <Text style={{ fontSize: 15, fontWeight: "500", color: t.accent }}>
              Сбросить на стандартные для роли
            </Text>
          </Pressable>
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
