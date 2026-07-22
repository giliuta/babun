import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, Pencil, Search, Users } from "lucide-react-native";
import {
  LEGACY_HELPER_ROLE_ID,
  LEGACY_LEAD_ROLE_ID,
  generateId,
  getInitials,
  type BrigadeMember,
  type BrigadeRole,
} from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  teamMembers,
  teamRoles,
  useMasters,
  useTeam,
  useUpdateTeamMembers,
  type Master,
  type Team,
} from "@/features/reference/queries";

// teams.lead_ids / helper_ids arrive from Supabase as Json — узкое
// приведение к string[] (те же касты, что в teams/[id]/index.tsx).
function legacyLeadIds(team: Team): string[] {
  const arr = Array.isArray(team.lead_ids)
    ? (team.lead_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  if (arr.length > 0) return arr;
  return team.lead_id ? [team.lead_id] : [];
}
function legacyHelperIds(team: Team): string[] {
  return Array.isArray(team.helper_ids)
    ? (team.helper_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
}

// ─── Brigade masters ─────────────────────────────────────────────────
// Web parity: teams/[id]/masters/page.tsx. Members are grouped by the
// team's own BrigadeRole[] (custom roles the dispatcher authors), plus a
// «Без роли» bucket. CRUD on roles (name + colour), a searchable picker
// to add active masters, and role reassignment — every write goes through
// updateTeamMembers, which re-derives lead_ids/helper_ids in the same
// update (RISK-2 parity: web finances/schedule still read the legacy
// arrays).

type RoleDraft = BrigadeRole | { id: null };

export default function BrigadeMastersScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamQuery = useTeam(id);
  const mastersQuery = useMasters();
  const { data: team } = teamQuery;
  const masters = useMemo(() => mastersQuery.data ?? [], [mastersQuery.data]);
  const save = useUpdateTeamMembers();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDraft | null>(null);

  const roles = useMemo(() => (team ? teamRoles(team) : []), [team]);
  const members = useMemo(() => (team ? teamMembers(team) : []), [team]);

  // Persist через updateTeamMembers — синхронно обновит lead_ids/helper_ids.
  const persist = (nextRoles: BrigadeRole[], nextMembers: BrigadeMember[]) => {
    if (!team) return;
    save.mutate(
      {
        teamId: team.id,
        expectedUpdatedAt: team.updated_at,
        roles: nextRoles,
        members: nextMembers,
      },
      { onError: (e) => Alert.alert("Ошибка", e.message) },
    );
  };

  // ── Ленивая миграция legacy-команд (web parity, masters/page.tsx) ──
  // На вебе триггер — `!team.members`. В моб `teams.members` заведена с
  // DEFAULT '[]'::jsonb, поэтому эквивалент — teamMembers пуст И непусты
  // legacy lead_ids/helper_ids: собираем roles+members из массивов один
  // раз (роли «Старший»/«Помощник» только для непустых бакетов, helper
  // минус lead) и пишем через updateTeamMembers. Без этого legacy-состав
  // не виден («Пусто»), а первое же действие пересобрало бы lead_ids/
  // helper_ids только из текущего members и стёрло исходный состав из
  // веб-финансов/расписания (RISK-2). Гейт по ref, чтобы не зациклиться,
  // пока write в полёте (после write teamMembers непуст → условие спадает).
  const migratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!team) return;
    if (teamMembers(team).length > 0) return; // уже на новой форме
    const leadIds = legacyLeadIds(team);
    const helperIds = legacyHelperIds(team);
    if (leadIds.length === 0 && helperIds.length === 0) return; // мигрировать нечего
    if (migratedFor.current === team.id) return; // write уже отправлен
    migratedFor.current = team.id;

    const existingRoles = teamRoles(team);
    const migratedRoles: BrigadeRole[] = [];
    if (leadIds.length > 0) {
      migratedRoles.push({
        id: LEGACY_LEAD_ROLE_ID,
        name: "Старший",
        color: "#FFCC00",
      });
    }
    if (helperIds.length > 0) {
      migratedRoles.push({
        id: LEGACY_HELPER_ROLE_ID,
        name: "Помощник",
        color: "#8E8E93",
      });
    }
    const migratedMembers: BrigadeMember[] = [
      ...leadIds.map((mid) => ({
        master_id: mid,
        role_id: LEGACY_LEAD_ROLE_ID,
      })),
      ...helperIds
        .filter((mid) => !leadIds.includes(mid))
        .map((mid) => ({ master_id: mid, role_id: LEGACY_HELPER_ROLE_ID })),
    ];
    save.mutate(
      {
        teamId: team.id,
        expectedUpdatedAt: team.updated_at,
        roles: [...existingRoles, ...migratedRoles],
        members: migratedMembers,
      },
      {
        onError: (e) => {
          migratedFor.current = null; // разрешить повтор при следующем рендере
          Alert.alert("Ошибка", e.message);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  // ── Group members by role (+ «Без роли») ──────────────────────────
  const grouped = useMemo(() => {
    const byRole = new Map<string | null, Master[]>();
    byRole.set(null, []);
    for (const r of roles) byRole.set(r.id, []);
    for (const m of members) {
      const master = masters.find((mm) => mm.id === m.master_id);
      if (!master) continue;
      const key =
        m.role_id && roles.some((r) => r.id === m.role_id) ? m.role_id : null;
      const arr = byRole.get(key) ?? [];
      arr.push(master);
      byRole.set(key, arr);
    }
    return byRole;
  }, [members, roles, masters]);

  const availableMasters = masters.filter(
    (m) => m.is_active && !members.some((mm) => mm.master_id === m.id),
  );

  // ── Role actions ──────────────────────────────────────────────────
  const saveRole = (draft: RoleDraft, name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (draft.id === null) {
      // create — dedupe by name (web parity createRole)
      const existing = roles.find(
        (r) => r.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        setEditingRole(null);
        return;
      }
      persist(
        [...roles, { id: generateId("role"), name: trimmed, color }],
        members,
      );
    } else {
      persist(
        roles.map((r) =>
          r.id === draft.id ? { ...r, name: trimmed, color } : r,
        ),
        members,
      );
    }
    setEditingRole(null);
  };

  const deleteRole = (role: BrigadeRole) => {
    const count = members.filter((m) => m.role_id === role.id).length;
    Alert.alert(
      `Удалить роль «${role.name}»?`,
      count > 0
        ? `${count} ${count === 1 ? "мастер перейдёт" : "мастера перейдут"} в «Без роли». Из команды они не выйдут.`
        : "Роль пустая — можно удалить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () => {
            persist(
              roles.filter((r) => r.id !== role.id),
              members.map((m) =>
                m.role_id === role.id ? { ...m, role_id: null } : m,
              ),
            );
            setEditingRole(null);
          },
        },
      ],
    );
  };

  // ── Member actions ────────────────────────────────────────────────
  const addMember = (masterId: string, roleId: string | null) => {
    if (members.some((m) => m.master_id === masterId)) return;
    persist(roles, [...members, { master_id: masterId, role_id: roleId }]);
    setPickerOpen(false);
  };

  // Тап по участнику → экран доступа под эту команду (per-brigade матрица +
  // смена роли + «убрать из команды»). Заменяет прежний RolePicker-модал.
  const openMemberAccess = (master: Master) => {
    if (!team) return;
    router.push(`/cabinet/teams/${team.id}/masters/${master.id}`);
  };

  if (teamQuery.isLoading || mastersQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастера" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  const readError = teamQuery.error || mastersQuery.error;
  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастера" />
        <EmptyState
          state="error"
          title="Не удалось загрузить состав команды"
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([teamQuery.refetch(), mastersQuery.refetch()]),
          }}
          fill
        />
      </Screen>
    );
  }
  if (!team) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастера" />
        <EmptyState title="Команда не найдена" fill />
      </Screen>
    );
  }

  const isEmpty = members.length === 0 && roles.length === 0;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Мастера"
        subtitle={team.name}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {isEmpty ? (
          <EmptyState
            icon={<Users color={t.sub} size={40} />}
            title="Пусто"
            subtitle="Добавьте мастера и назначьте роль — например «Установщик» или «Электрик»."
          />
        ) : (
          <>
            {roles.map((role) => (
              <RoleGroup
                key={role.id}
                role={role}
                people={grouped.get(role.id) ?? []}
                onEditRole={() => setEditingRole(role)}
                onTapMember={openMemberAccess}
              />
            ))}
            {(grouped.get(null)?.length ?? 0) > 0 ? (
              <RoleGroup
                role={null}
                people={grouped.get(null) ?? []}
                onTapMember={openMemberAccess}
              />
            ) : null}
          </>
        )}

        <SectionCard className={isEmpty ? "mt-5" : "mt-2"}>
          <AddRow
            label="Добавить мастера"
            onPress={() => {
              if (availableMasters.length === 0) {
                Alert.alert(
                  "Все мастера уже в команде",
                  "Заведите нового мастера в разделе «Мастера», затем вернитесь сюда.",
                );
                return;
              }
              setPickerOpen(true);
            }}
          />
          <Divider inset={16} />
          <AddRow
            label="Создать роль"
            onPress={() => setEditingRole({ id: null })}
          />
        </SectionCard>
      </ScrollView>

      {/* Role editor */}
      <RoleSheet
        draft={editingRole}
        busy={save.isPending}
        onClose={() => setEditingRole(null)}
        onSave={saveRole}
        onDelete={
          editingRole && editingRole.id !== null
            ? () => deleteRole(editingRole)
            : undefined
        }
      />

      {/* Add-member picker */}
      <AddMemberPicker
        open={pickerOpen}
        masters={availableMasters}
        roles={roles}
        onClose={() => setPickerOpen(false)}
        onAdd={addMember}
      />
    </Screen>
  );
}

// ─── Role group ──────────────────────────────────────────────────────
function RoleGroup({
  role,
  people,
  onEditRole,
  onTapMember,
}: {
  role: BrigadeRole | null;
  people: Master[];
  onEditRole?: () => void;
  onTapMember: (m: Master) => void;
}) {
  const t = useThemeColors();
  return (
    <View className="mt-5">
      <View className="flex-row items-center px-5 pb-2">
        {role?.color ? (
          <View
            className="mr-2 h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: role.color }}
          />
        ) : null}
        <Text
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
          numberOfLines={1}
        >
          {role ? role.name : "Без роли"}
        </Text>
        {role && onEditRole ? (
          <Pressable
            onPress={onEditRole}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Редактировать роль ${role.name}`}
            className="active:opacity-60"
          >
            <Pencil color={t.faint} size={ICON.xs} />
          </Pressable>
        ) : null}
      </View>
      <SectionCard className="mt-0">
        {people.length === 0 ? (
          <View className="px-4 py-3">
            <Text style={{ fontSize: 13, color: t.faint }}>
              В этой роли пока никого.
            </Text>
          </View>
        ) : (
          people.map((m, i) => (
            <View key={m.id}>
              {i > 0 ? <Divider inset={60} /> : null}
              <Pressable
                onPress={() => onTapMember(m)}
                accessibilityRole="button"
                accessibilityLabel={m.full_name}
                className="min-h-[52px] flex-row items-center px-4 py-2.5 active:opacity-60"
              >
                <Avatar master={m} color={role?.color} />
                <View className="ml-3 flex-1 pr-2">
                  <Text
                    style={{ fontSize: 16, color: t.ink }}
                    numberOfLines={1}
                  >
                    {m.full_name}
                  </Text>
                  {m.title ? (
                    <Text
                      style={{ fontSize: 13, color: t.sub }}
                      numberOfLines={1}
                    >
                      {m.title}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))
        )}
      </SectionCard>
    </View>
  );
}

function Avatar({ master, color }: { master: Master; color?: string }) {
  const t = useThemeColors();
  const tint = master.color ?? color ?? t.accent;
  return (
    <View
      className="h-9 w-9 items-center justify-center rounded-full"
      style={{ backgroundColor: `${tint}22` }}
    >
      <Text style={{ fontSize: 13, fontWeight: "700", color: tint }}>
        {getInitials(master.full_name)}
      </Text>
    </View>
  );
}

// ─── Role editor sheet ───────────────────────────────────────────────
function RoleSheet({
  draft,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  draft: RoleDraft | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: RoleDraft, name: string, color: string) => void;
  onDelete?: () => void;
}) {
  const t = useThemeColors();
  const existing = draft && draft.id !== null ? draft : null;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("");
  const [seeded, setSeeded] = useState<RoleDraft | null>(null);

  if (draft !== seeded) {
    setSeeded(draft);
    setName(existing?.name ?? "");
    setColor(existing?.color ?? "");
  }

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <Modal
      visible={draft !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable
            className="flex-1"
            onPress={onClose}
            accessible={false}
          />
          <View
            className="max-h-[88%] rounded-t-3xl"
            style={{ backgroundColor: t.surface }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
            >
              <Text className="mb-4 text-lg font-bold" style={{ color: t.ink }}>
                {existing ? "Роль" : "Новая роль"}
              </Text>
              <Text
                style={{ marginBottom: 4, fontSize: 14, fontWeight: "500", color: t.sub }}
              >
                Название
              </Text>
          <TextInput
            value={name}
            accessibilityLabel="Название роли"
                onChangeText={setName}
                placeholder="Установщик"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                autoFocus={!existing}
                style={{
                  borderRadius: t.radius.input,
                  borderWidth: 1,
                  borderColor: t.separator,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: t.ink,
                  marginBottom: 16,
                }}
              />
              <ColorPicker value={color} onChange={setColor} label="Цвет роли" />
              <Button
                label={existing ? "Сохранить" : "Создать"}
                onPress={() => draft && onSave(draft, name, color)}
                disabled={!canSubmit}
                loading={busy}
              />
              {onDelete ? (
                <Pressable
                  onPress={onDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить роль"
                  className="mt-1 items-center py-3 active:opacity-70"
                >
                  <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                    Удалить
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add-member picker (searchable) ──────────────────────────────────
function AddMemberPicker({
  open,
  masters,
  roles,
  onClose,
  onAdd,
}: {
  open: boolean;
  masters: Master[];
  roles: BrigadeRole[];
  onClose: () => void;
  onAdd: (masterId: string, roleId: string | null) => void;
}) {
  const t = useThemeColors();
  const [query, setQuery] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  if (open !== seeded) {
    setSeeded(open);
    if (open) {
      setQuery("");
      setRoleId(null);
    }
  }

  const filtered = masters.filter((m) =>
    m.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable
            className="flex-1"
            onPress={onClose}
            accessible={false}
          />
          <View
            className="max-h-[88%] rounded-t-3xl"
            style={{ backgroundColor: t.surface }}
          >
            <View className="px-5 pb-2 pt-5">
              <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
                Добавить мастера
              </Text>
              {/* Роль по умолчанию для добавляемого */}
              {roles.length > 0 ? (
                <View className="mb-3 flex-row flex-wrap gap-2">
                  <Chip
                    label="Без роли"
                    radio
                    selected={roleId === null}
                    onPress={() => setRoleId(null)}
                  />
                  {roles.map((r) => (
                    <Chip
                      key={r.id}
                      label={r.name}
                      radio
                      selected={roleId === r.id}
                      onPress={() => setRoleId(r.id)}
                      color={r.color ?? undefined}
                      variant={r.color ? "tint" : "filled"}
                      accessibilityLabel={`Роль ${r.name}`}
                    />
                  ))}
                </View>
              ) : null}
              {/* Поиск */}
              <View
                className="flex-row items-center rounded-2xl px-3"
                style={{ backgroundColor: t.fill }}
              >
                <Search color={t.faint} size={ICON.sm} />
          <TextInput
            value={query}
            accessibilityLabel="Поиск мастера"
                  onChangeText={setQuery}
                  placeholder="Поиск мастера"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    paddingHorizontal: 8,
                    fontSize: 16,
                    color: t.ink,
                  }}
                />
              </View>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 32 }}
            >
              {filtered.length === 0 ? (
                <View className="px-5 py-8">
                  <Text
                    style={{ textAlign: "center", fontSize: 14, color: t.faint }}
                  >
                    {masters.length === 0
                      ? "Все активные мастера уже в команде."
                      : "Ничего не найдено."}
                  </Text>
                </View>
              ) : (
                filtered.map((m, i) => (
                  <View key={m.id}>
                    {i > 0 ? <Divider inset={60} /> : null}
                    <Pressable
                      onPress={() => onAdd(m.id, roleId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Добавить ${m.full_name}`}
                      className="min-h-[52px] flex-row items-center px-4 py-2.5 active:opacity-60"
                    >
                      <Avatar master={m} />
                      <View className="ml-3 flex-1 pr-2">
                        <Text
                          style={{ fontSize: 16, color: t.ink }}
                          numberOfLines={1}
                        >
                          {m.full_name}
                        </Text>
                        {m.phone ? (
                          <Text
                            style={{ fontSize: 13, color: t.sub }}
                            numberOfLines={1}
                          >
                            {m.phone}
                          </Text>
                        ) : null}
                      </View>
                      <ChevronRight color={t.chevron} size={ICON.sm} />
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
