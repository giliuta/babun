import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Minus,
  Package,
  Plus,
  Trash2,
  Users as UsersIcon,
  Wrench,
} from "lucide-react-native";
import { TIMEZONE_OPTIONS } from "@babun/shared/local/calendar-settings";
import { TEAM_COLORS } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  teamMembers,
  useDetachTeamReferences,
  useMasters,
  useTeam,
  useUpdateTeam,
} from "@/features/reference/queries";

// ─── Brigade hub ─────────────────────────────────────────────────────
// Web parity: teams/[id]/page.tsx — a nav hub, not a form. Header (colour
// dot + name, editable inline), nav rows (Мастера / Услуги / Оборудование),
// a collapsed «Календарь бригады» section (hours / buffer / behaviour
// toggles / timezone — commits straight to the team columns), an «активна»
// toggle and a destructive delete.

function SectionEyebrow({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      style={{
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 8,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
      }}
    >
      {children}
    </Text>
  );
}

function NavRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  value?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[52px] flex-row items-center px-4 py-2.5 active:opacity-60"
    >
      <View className="mr-3">{icon}</View>
      <View className="flex-1 pr-2">
        <Text style={{ fontSize: 16, color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        {value ? (
          <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center px-4 py-2.5">
      <View className="flex-1 pr-3">
        <Text style={{ fontSize: 16, color: t.ink }}>{label}</Text>
        {hint ? (
          <Text style={{ fontSize: 12, color: t.faint, marginTop: 1 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent }}
        accessibilityLabel={label}
      />
    </View>
  );
}

// Small HH:MM window input pair (visible calendar band). Empty = auto.
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState(value);
  // Reseed if the underlying value changed (fresh fetch) and we're idle.
  const [seed, setSeed] = useState(value);
  if (value !== seed) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <View className="flex-row items-center justify-between px-4 py-2.5">
      <Text style={{ fontSize: 16, color: t.ink }}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => onCommit(draft.trim())}
        placeholder="—:—"
        placeholderTextColor={t.placeholder}
        keyboardType="numbers-and-punctuation"
        selectionColor={t.accent}
        keyboardAppearance={t.dark ? "dark" : "light"}
        maxLength={5}
        style={{
          minWidth: 72,
          textAlign: "center",
          borderRadius: t.radius.input,
          borderWidth: 1,
          borderColor: t.separator,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 16,
          color: t.ink,
        }}
      />
    </View>
  );
}

function BufferStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(0, value - 5))}
        style={{ backgroundColor: t.fill }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Меньше буфер"
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Minus color={t.body} size={16} />
      </Pressable>
      <Text
        style={{ color: t.ink }}
        className="w-16 text-center text-base font-semibold tabular-nums"
      >
        {value} мин
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(120, value + 5))}
        style={{ backgroundColor: t.fill }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Больше буфер"
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Plus color={t.body} size={16} />
      </Pressable>
    </View>
  );
}

export default function TeamHubScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: team, isLoading } = useTeam(id);
  const { data: masters = [] } = useMasters();
  const update = useUpdateTeam();
  const detach = useDetachTeamReferences();

  const [colorOpen, setColorOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Команда" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Команда" />
        <EmptyState
          title="Команда не найдена"
          action={{ label: "К списку", onPress: () => router.back() }}
          fill
        />
      </Screen>
    );
  }

  // Instant commit helper — patches only the touched columns. No optimistic
  // update: useUpdateTeam invalidates ["teams"], which refetches this hub.
  const patch = (p: Record<string, unknown>) => {
    update.mutate(
      { id: team.id, patch: p },
      { onError: (e) => Alert.alert("Ошибка", e.message) },
    );
  };

  const nameDraft = name ?? team.name;

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === team.name) {
      setName(null);
      return;
    }
    patch({ name: trimmed });
    setName(null);
  };

  // ── Мастера preview (первые 2 имени) — web parity mastersPreview ──
  // Prefer the new `members` shape; fall back to legacy lead_ids/helper_ids
  // (both round-trip through jsonb, so guard the array cast).
  const legacyLead = Array.isArray(team.lead_ids)
    ? (team.lead_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const legacyHelper = Array.isArray(team.helper_ids)
    ? (team.helper_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const members = teamMembers(team);
  const memberIds = members.length
    ? members.map((m) => m.master_id)
    : [...legacyLead, ...legacyHelper];
  const memberNames = memberIds
    .map((mid) => masters.find((m) => m.id === mid)?.full_name)
    .filter((n): n is string => Boolean(n));
  const mastersPreview =
    memberNames.length === 0
      ? "нет участников"
      : memberNames.length <= 2
        ? memberNames.join(" · ")
        : `${memberNames[0]} · ${memberNames[1]} и ещё ${memberNames.length - 2}`;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={team.name || "Команда"}
        subtitle={team.region ?? undefined}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Header: colour dot + editable name + colour picker toggle */}
          <SectionCard>
            <View className="flex-row items-center px-4 py-3">
              <Pressable
                onPress={() => setColorOpen((o) => !o)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Изменить цвет команды"
                className="mr-3 active:opacity-60"
              >
                <View
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: team.color ?? t.faint }}
                />
              </Pressable>
              <TextInput
                value={nameDraft}
                onChangeText={setName}
                onBlur={commitName}
                placeholder="Название команды"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                returnKeyType="done"
                onSubmitEditing={commitName}
                style={{ flex: 1, fontSize: 18, fontWeight: "600", color: t.ink }}
              />
              <Pressable
                onPress={() => setColorOpen((o) => !o)}
                hitSlop={8}
                accessibilityLabel="Цвет"
              >
                {colorOpen ? (
                  <ChevronUp color={t.chevron} size={ICON.sm} />
                ) : (
                  <ChevronDown color={t.chevron} size={ICON.sm} />
                )}
              </Pressable>
            </View>
            {colorOpen ? (
              <>
                <Divider />
                <View className="px-4 pt-3">
                  <ColorPicker
                    value={team.color}
                    onChange={(hex) => patch({ color: hex })}
                    colors={TEAM_COLORS.map((c) => c.value)}
                    label={null}
                  />
                </View>
              </>
            ) : null}
          </SectionCard>

          {/* Nav rows */}
          <SectionCard className="mt-5">
            <NavRow
              icon={<UsersIcon color={t.accent} size={ICON.md} />}
              title="Мастера"
              value={mastersPreview}
              onPress={() =>
                router.push(`/cabinet/teams/${team.id}/masters`)
              }
            />
            <Divider inset={52} />
            <NavRow
              icon={<Wrench color={t.accent} size={ICON.md} />}
              title="Услуги"
              onPress={() => router.push("/cabinet/services")}
            />
            <Divider inset={52} />
            <NavRow
              icon={<Package color={t.accent} size={ICON.md} />}
              title="Оборудование"
              onPress={() => router.push("/cabinet/inventory")}
            />
          </SectionCard>

          {/* Календарь бригады — collapsed */}
          <SectionEyebrow>Календарь бригады</SectionEyebrow>
          <SectionCard>
            <Pressable
              onPress={() => setCalOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel="Настройки календаря бригады"
              className="flex-row items-center px-4 py-3 active:opacity-60"
            >
              <Text style={{ flex: 1, fontSize: 16, color: t.ink }}>
                Часы и поведение
              </Text>
              {calOpen ? (
                <ChevronUp color={t.chevron} size={ICON.sm} />
              ) : (
                <ChevronDown color={t.chevron} size={ICON.sm} />
              )}
            </Pressable>
            {calOpen ? (
              <>
                <Divider />
                <TimeField
                  label="Начало дня"
                  value={team.calendar_window_start ?? ""}
                  onCommit={(v) =>
                    patch({ calendar_window_start: v || null })
                  }
                />
                <Divider inset={16} />
                <TimeField
                  label="Конец дня"
                  value={team.calendar_window_end ?? ""}
                  onCommit={(v) => patch({ calendar_window_end: v || null })}
                />
                <Divider inset={16} />
                <View className="flex-row items-center justify-between px-4 py-2.5">
                  <Text style={{ fontSize: 16, color: t.ink }}>
                    Буфер между записями
                  </Text>
                  <BufferStepper
                    value={team.buffer_minutes ?? 0}
                    onChange={(v) => patch({ buffer_minutes: v })}
                  />
                </View>
                <Divider inset={16} />
                <ToggleRow
                  label="Скрывать отменённые"
                  value={!!team.hide_cancelled}
                  onChange={(v) => patch({ hide_cancelled: v })}
                />
                <Divider inset={16} />
                <ToggleRow
                  label="Разрешить переработку"
                  hint="Записи можно ставить вне рабочих часов"
                  value={!!team.allow_overtime}
                  onChange={(v) => patch({ allow_overtime: v })}
                />
                <Divider inset={16} />
                <View className="px-4 pb-3 pt-2.5">
                  <Text
                    style={{ fontSize: 12, color: t.sub, marginBottom: 8 }}
                  >
                    Часовой пояс
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <Chip
                        key={tz}
                        label={tz.replace(/^.*\//, "")}
                        radio
                        selected={(team.timezone ?? "") === tz}
                        onPress={() => patch({ timezone: tz })}
                        accessibilityLabel={`Часовой пояс ${tz}`}
                      />
                    ))}
                  </View>
                </View>
              </>
            ) : null}
          </SectionCard>

          {/* Активна */}
          <SectionCard className="mt-5">
            <ToggleRow
              label="Команда активна"
              hint={
                team.is_active
                  ? "Показывается в списках, календаре и выборе."
                  : "Скрыта — можно вернуть в любой момент."
              }
              value={team.is_active}
              onChange={(v) => patch({ is_active: v })}
            />
          </SectionCard>

          {/* Удалить */}
          <View className="mx-3 mt-8">
            <Pressable
              onPress={() =>
                Alert.alert(
                  `Удалить команду «${team.name}»?`,
                  "Команда скроется из списков. Привязку записей к ней нужно будет переназначить вручную.",
                  [
                    { text: "Отмена", style: "cancel" },
                    {
                      text: "Удалить",
                      style: "destructive",
                      onPress: () => {
                        // Soft-delete через is_active=false (как useDeleteTeam),
                        // затем reset team_id у мастеров и записей этой команды —
                        // parity с web handleDelete (мастер/запись не должны
                        // ссылаться на исчезнувшую бригаду; иначе мастер молча
                        // вернётся при повторном включении «активна»).
                        update.mutate(
                          { id: team.id, patch: { is_active: false } },
                          {
                            onError: (e) => Alert.alert("Ошибка", e.message),
                            onSuccess: () =>
                              detach.mutate(team.id, {
                                onError: (e) =>
                                  Alert.alert("Ошибка", e.message),
                                onSettled: () => router.back(),
                              }),
                          },
                        );
                      },
                    },
                  ],
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Удалить команду"
              className="flex-row items-center justify-center gap-2 rounded-2xl py-3.5 active:opacity-70"
              style={{ backgroundColor: t.surface }}
            >
              <Trash2 color={t.danger} size={16} />
              <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                Удалить команду
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
