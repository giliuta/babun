import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Pencil, UserMinus } from "lucide-react-native";
import {
  getInitials,
  type BrigadeMember,
  type BrigadeRole,
} from "@babun/shared/local/masters";
import {
  BRIGADE_PERMISSION_GROUPS,
  DEFAULT_BRIGADE_MEMBER_PERMISSIONS,
  READ_ONLY_BRIGADE_MEMBER_PERMISSIONS,
  countEnabled,
  resolveMemberPermissions,
  type BrigadeMemberPermissions,
  type BrigadePermissionKey,
  type FlagRow,
} from "@babun/shared/local/brigade-permissions";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  teamMembers,
  teamRoles,
  useMaster,
  useTeam,
  useUpdateTeamMembers,
} from "@/features/reference/queries";

// ─── Per-brigade member access (web parity: teams/[id]/masters/[masterId]) ──
// The SAME master can carry a different reach in each brigade (SaaS: «Дима —
// диспетчер в Y&D, но у D&K только читает»). These BrigadeMemberPermissions
// (~55 flags across 12 groups) live INSIDE team.members[member].permissions —
// NOT on the master. They narrow-scope the brigade's calendar/records only;
// master.role still owns global reach (see masters/[id]/access).
//
// Every write goes through useUpdateTeamMembers: we find this member, swap its
// permissions (or role_id), and re-persist the WHOLE members array so the hook
// re-derives lead_ids/helper_ids in the same update (RISK-2 parity: web
// finances/schedule still read the legacy arrays). Parent rows gate their
// indented children — when a group's `parent` flag is OFF the children render
// disabled+greyed (mirrors the actual runtime gating).

export default function BrigadeMemberAccessScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id, masterId } = useLocalSearchParams<{ id: string; masterId: string }>();
  const teamQuery = useTeam(id);
  const masterQuery = useMaster(masterId);
  const { data: team } = teamQuery;
  const { data: master } = masterQuery;
  const save = useUpdateTeamMembers();

  const [roleEditorOpen, setRoleEditorOpen] = useState(false);

  const roles: BrigadeRole[] = team ? teamRoles(team) : [];
  const members: BrigadeMember[] = team ? teamMembers(team) : [];
  const member = members.find((mm) => mm.master_id === masterId) ?? null;
  const role = member?.role_id
    ? (roles.find((r) => r.id === member.role_id) ?? null)
    : null;

  const permissions = useMemo(
    () => resolveMemberPermissions(member?.permissions),
    [member?.permissions],
  );
  const counts = useMemo(() => countEnabled(permissions), [permissions]);

  if (teamQuery.isLoading || masterQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступ" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  const readError = teamQuery.error || masterQuery.error;
  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступ" />
        <EmptyState
          state="error"
          title="Не удалось загрузить доступ"
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([teamQuery.refetch(), masterQuery.refetch()]),
          }}
          fill
        />
      </Screen>
    );
  }
  if (!team || !master || !member) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступ" />
        <EmptyState title="Участник не найден" fill />
      </Screen>
    );
  }
  const tm = team;
  const currentMember = member;

  // ── Persist helpers ─────────────────────────────────────────────
  const persistPermissions = (next: BrigadeMemberPermissions) => {
    const nextMembers = members.map((mm) =>
      mm.master_id === masterId ? { ...mm, permissions: next } : mm,
    );
    save.mutate(
      {
        teamId: tm.id,
        expectedUpdatedAt: tm.updated_at,
        roles,
        members: nextMembers,
      },
      { onError: (e) => notify("Ошибка", e.message) },
    );
  };

  const persistRole = (roleId: string | null) => {
    const nextMembers = members.map((mm) =>
      mm.master_id === masterId ? { ...mm, role_id: roleId } : mm,
    );
    // lead_ids/helper_ids re-derived inside useUpdateTeamMembers (RISK-2).
    save.mutate(
      {
        teamId: tm.id,
        expectedUpdatedAt: tm.updated_at,
        roles,
        members: nextMembers,
      },
      { onError: (e) => notify("Ошибка", e.message) },
    );
  };

  const toggleFlag = (key: BrigadePermissionKey) => {
    persistPermissions({ ...permissions, [key]: !permissions[key] });
  };

  const applyPreset = (preset: "full" | "read" | "reset") => {
    // «Сброс» = full access (web backward-compat stance).
    persistPermissions(
      preset === "read"
        ? READ_ONLY_BRIGADE_MEMBER_PERMISSIONS
        : DEFAULT_BRIGADE_MEMBER_PERMISSIONS,
    );
  };

  const handleRemove = () => {
    confirmThen(
      `Убрать ${master.full_name} из команды?`,
      {
        message: "Мастер останется в разделе «Мастера», но больше не будет в этой команде.",
        confirmLabel: "Убрать",
        destructive: true,
      },
      () => {
        const nextMembers = members.filter((mm) => mm.master_id !== masterId);
        save.mutate(
          {
            teamId: tm.id,
            expectedUpdatedAt: tm.updated_at,
            roles,
            members: nextMembers,
          },
          {
            onError: (e) => notify("Ошибка", e.message),
            onSuccess: () =>
              router.canGoBack()
                ? router.back()
                : router.replace(`/cabinet/teams/${tm.id}/masters`),
          },
        );
      },
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Доступ" subtitle={`В команде «${tm.name}»`} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* ── Header ───────────────────────────────────────────── */}
        <SectionCard padded>
          <View className="items-center">
            <View
              className="mb-2 h-16 w-16 items-center justify-center rounded-full"
              style={{
                backgroundColor: tm.color ?? t.accent,
                borderWidth: role?.color ? 2 : 0,
                borderColor: role?.color ?? "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "700",
                  color: readableForeground(tm.color ?? t.accent),
                }}
              >
                {getInitials(master.full_name)}
              </Text>
            </View>
            <Text
              style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
              numberOfLines={1}
            >
              {master.full_name}
            </Text>
            <Pressable
              onPress={() => setRoleEditorOpen(true)}
              hitSlop={7}
              accessibilityRole="button"
              accessibilityLabel="Изменить роль в команде"
              className="mt-3 flex-row items-center gap-2 rounded-full px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: t.fill }}
            >
              {role?.color ? (
                <View
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: role.color }}
                />
              ) : null}
              <Text style={{ fontSize: 13, fontWeight: "500", color: t.ink }}>
                {role?.name ?? "Без роли"}
              </Text>
              <Pencil color={t.sub} size={12} />
            </Pressable>
          </View>
        </SectionCard>

        {/* ── Пресеты ──────────────────────────────────────────── */}
        <View className="mx-3 mt-4 flex-row gap-2">
          <PresetButton label="Полный" onPress={() => applyPreset("full")} />
          <PresetButton label="Только смотреть" onPress={() => applyPreset("read")} />
          <PresetButton label="Сброс" onPress={() => applyPreset("reset")} />
        </View>
        <Text
          style={{
            fontSize: 12,
            color: t.faint,
            lineHeight: 16,
            paddingHorizontal: 20,
            paddingTop: 8,
          }}
        >
          Включено {counts.on} из {counts.total} прав.
        </Text>

        {/* ── Группы прав ──────────────────────────────────────── */}
        {BRIGADE_PERMISSION_GROUPS.map((group) => {
          const parentOn = group.parent ? permissions[group.parent] : true;
          return (
            <View key={group.id} className="mt-4">
              <View className="flex-row items-center px-5 pb-1.5">
                <Text style={{ fontSize: 13, marginRight: 6 }}>{group.emoji}</Text>
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
              </View>
              <SectionCard className="mt-0">
                {group.rows.map((row, i) => {
                  const disabled = Boolean(row.indent && !parentOn);
                  return (
                    <View key={row.key}>
                      {i > 0 ? <Divider inset={row.indent ? 32 : 16} /> : null}
                      <FlagRowView
                        row={row}
                        value={permissions[row.key]}
                        disabled={disabled}
                        onToggle={() => toggleFlag(row.key)}
                      />
                    </View>
                  );
                })}
              </SectionCard>
            </View>
          );
        })}

        {/* ── Убрать из команды ────────────────────────────────── */}
        <SectionCard className="mt-5">
          <Pressable
            onPress={handleRemove}
            accessibilityRole="button"
            accessibilityLabel="Убрать из команды"
            className="min-h-[48px] flex-row items-center justify-center gap-2 px-4 active:opacity-70"
          >
            <UserMinus color={t.danger} size={ICON.sm} />
            <Text style={{ fontSize: 15, fontWeight: "500", color: t.danger }}>
              Убрать из команды
            </Text>
          </Pressable>
        </SectionCard>
      </ScrollView>

      {/* Role picker */}
      <RolePickerSheet
        open={roleEditorOpen}
        masterName={master.full_name}
        roles={roles}
        currentRoleId={currentMember.role_id}
        onClose={() => setRoleEditorOpen(false)}
        onPick={(roleId) => {
          persistRole(roleId);
          setRoleEditorOpen(false);
        }}
      />
    </Screen>
  );
}

// ─── Preset button ──────────────────────────────────────────────────
function PresetButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: t.radius.card,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.separator,
      }}
      className="active:opacity-70"
    >
      <Text
        style={{ fontSize: 13, fontWeight: "500", color: t.ink }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Single flag row ────────────────────────────────────────────────
function FlagRowView({
  row,
  value,
  disabled,
  onToggle,
}: {
  row: FlagRow;
  value: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      className="min-h-[52px] flex-row items-start px-4 py-2.5"
      style={{ opacity: disabled ? 0.4 : 1, paddingLeft: row.indent ? 32 : 16 }}
    >
      <View className="flex-1 pr-3">
        <Text style={{ fontSize: 14, color: t.ink, lineHeight: 19 }}>
          {row.label}
        </Text>
        {row.description ? (
          <Text style={{ fontSize: 11, color: t.faint, lineHeight: 15, marginTop: 2 }}>
            {row.description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ true: t.accent }}
        accessibilityLabel={row.label}
      />
    </View>
  );
}

// ─── Role picker sheet (reassign role within brigade) ───────────────
function RolePickerSheet({
  open,
  masterName,
  roles,
  currentRoleId,
  onClose,
  onPick,
}: {
  open: boolean;
  masterName: string;
  roles: BrigadeRole[];
  currentRoleId: string | null;
  onClose: () => void;
  onPick: (roleId: string | null) => void;
}) {
  const t = useThemeColors();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={onClose} accessible={false} />
        <View
          className="max-h-[88%] rounded-t-[10px]"
          style={{ backgroundColor: t.surface }}
        >
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
            <Text className="mb-1 text-lg font-bold" style={{ color: t.ink }}>
              {masterName}
            </Text>
            <Text className="mb-4 text-sm" style={{ color: t.sub }}>
              Роль в команде
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label="Без роли"
                radio
                selected={currentRoleId === null}
                onPress={() => onPick(null)}
              />
              {roles.map((r) => (
                <Chip
                  key={r.id}
                  label={r.name}
                  radio
                  selected={currentRoleId === r.id}
                  onPress={() => onPick(r.id)}
                  color={r.color ?? undefined}
                  variant={r.color ? "tint" : "filled"}
                  accessibilityLabel={`Роль ${r.name}`}
                  icon={
                    currentRoleId === r.id && r.color ? (
                      <Check color={r.color} size={ICON.xs} />
                    ) : null
                  }
                />
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
