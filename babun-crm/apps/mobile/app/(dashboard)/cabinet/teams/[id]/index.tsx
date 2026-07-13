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
  MapPin,
  Package,
  Trash2,
  Users as UsersIcon,
  Wrench,
} from "lucide-react-native";
import { TIMEZONE_OPTIONS } from "@babun/shared/local/calendar-settings";
import { TEAM_COLORS } from "@babun/shared/local/masters";
import {
  DEFAULT_SCHEDULE,
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  type TeamSchedule,
  type WeekdayKey,
} from "@babun/shared/local/schedule";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { Divider } from "@/components/ui/Divider";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  teamCities,
  teamMembers,
  useDetachTeamReferences,
  useMasters,
  useTeam,
  useUpdateTeam,
} from "@/features/reference/queries";
import { serviceBrigadeIds, useServices } from "@/features/services/queries";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";

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
  warning,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  value?: string;
  /** Подсветить value как «требует внимания» (web parity BrigadeNavRow). */
  warning?: boolean;
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
          <Text
            style={{ fontSize: 14, color: warning ? t.warning : t.sub }}
            numberOfLines={1}
          >
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

// Normalize free-text time to canonical HH:MM: «9» → «09:00», «9:30» →
// «09:30»; hours 0–23, minutes 0–59; anything else → null. Web parity: web
// writes only wheel-picker values into calendar_window_*/default_scroll_time/
// schedule, and its parseHour silently discards garbage — so mobile must not
// persist strings that would look saved but be ignored.
function normalizeTimeInput(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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
  // Commit only canonical HH:MM (or empty = auto); invalid input reverts
  // the draft to the last persisted value and skips the patch entirely.
  const commit = () => {
    const raw = draft.trim();
    if (raw === "") {
      onCommit("");
      return;
    }
    const norm = normalizeTimeInput(raw);
    if (norm === null) {
      setDraft(value);
      return;
    }
    setDraft(norm);
    onCommit(norm);
  };
  return (
    <View className="flex-row items-center justify-between px-4 py-2.5">
      <Text style={{ fontSize: 16, color: t.ink }}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
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

// Буфер между записями — фиксированный ряд вариантов (web parity: чипы
// 0/10/…/60 в teams/[id]/calendar). null = наследовать глобальную настройку
// из «Мой календарь» (web-семантика undefined) — пишем null, а не 0, иначе
// команда навсегда пришпилена и глобальное значение перестаёт действовать.
const BUFFER_OPTIONS: { label: string; v: number | null }[] = [
  { label: "Нет", v: null },
  { label: "10 м", v: 10 },
  { label: "15 м", v: 15 },
  { label: "20 м", v: 20 },
  { label: "30 м", v: 30 },
  { label: "45 м", v: 45 },
  { label: "60 м", v: 60 },
];

export default function TeamHubScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: team, isLoading } = useTeam(id);
  const { data: masters = [] } = useMasters();
  // Для value-превью «Услуги» — тот же источник, что у веб-хаба
  // (servicesPreview в teams/[id]/page.tsx): привязка живёт в
  // services.brigade_ids, у команды своей колонки нет.
  const { data: services = [] } = useServices();
  const { data: schedule } = useTeamSchedule(id);
  const update = useUpdateTeam();
  const upsertSchedule = useUpsertTeamSchedule();
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

  // Рабочие часы (team_schedules). Строка хранит весь TeamSchedule; редактор
  // мержит одно поле на текущий (или DEFAULT) blob в TS и upsert'ит целиком.
  const sched: TeamSchedule = schedule ?? DEFAULT_SCHEDULE;
  const patchSchedule = (p: Partial<TeamSchedule>) => {
    upsertSchedule.mutate(
      { teamId: team.id, schedule: { ...sched, ...p } },
      { onError: (e) => Alert.alert("Ошибка", (e as Error).message) },
    );
  };
  // Рабочий день недели: включён/выключен через overrides[key]. Отсутствие ключа
  // = день работает по общему расписанию (is_working=true).
  const dayWorking = (key: WeekdayKey): boolean =>
    sched.overrides?.[key]?.is_working ?? true;
  const toggleDay = (key: WeekdayKey, working: boolean) => {
    const base = sched.overrides?.[key] ?? {
      is_working: true,
      start: sched.start,
      end: sched.end,
      breaks: [],
    };
    patchSchedule({
      overrides: {
        ...(sched.overrides ?? {}),
        [key]: { ...base, is_working: working },
      },
    });
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

  // ── Услуги preview — web parity servicesPreview (teams/[id]/page.tsx):
  // ноль привязанных услуг = «доступны все» (валидная настройка бригады,
  // сознательно НЕ warning). useServices уже отдаёт только is_active.
  const teamServicesCount = services.filter((s) =>
    serviceBrigadeIds(s).includes(team.id),
  ).length;
  const servicesPreview =
    teamServicesCount === 0
      ? "не заданы — доступны все"
      : `выбрано: ${teamServicesCount}`;

  // ── Метки preview — web parity citiesPreview (teams/[id]/calendar):
  // без меток И без города по умолчанию календарь не подскажет город —
  // это warning; иначе имена через запятую (длинный хвост обрезает
  // numberOfLines у NavRow).
  const cityNames = teamCities(team);
  const effectiveCityNames =
    cityNames.length === 0 && team.default_city
      ? [team.default_city]
      : cityNames;
  const citiesPreview =
    effectiveCityNames.length === 0
      ? null
      : effectiveCityNames.length <= 3
        ? effectiveCityNames.join(", ")
        : `${effectiveCityNames.slice(0, 2).join(", ")} и ещё ${effectiveCityNames.length - 2}`;

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
              value={servicesPreview}
              onPress={() => router.push(`/cabinet/teams/${team.id}/services`)}
            />
            <Divider inset={52} />
            {/* Оборудование без превью: данных на этом экране нет, а грузить
                каталог ради одной цифры — лишний запрос. */}
            <NavRow
              icon={<Package color={t.accent} size={ICON.md} />}
              title="Оборудование"
              onPress={() => router.push(`/cabinet/teams/${team.id}/equipment`)}
            />
            <Divider inset={52} />
            {/* Метки — web parity: в вебе живёт в calendar-подхабе рядом с
                «Запись» (teams/[id]/calendar → Метки/cities). Здесь настройки
                календаря свёрнуты в хаб, поэтому строка стоит рядом с осталь-
                ными nav-строками. Ведёт на team.cities[] + default_city ★. */}
            <NavRow
              icon={<MapPin color={t.accent} size={ICON.md} />}
              title="Метки"
              value={citiesPreview ?? "не заданы"}
              warning={!citiesPreview}
              onPress={() => router.push(`/cabinet/teams/${team.id}/cities`)}
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
                  label="Видимое время: с"
                  value={team.calendar_window_start ?? ""}
                  onCommit={(v) =>
                    patch({ calendar_window_start: v || null })
                  }
                />
                <Divider inset={16} />
                <TimeField
                  label="Видимое время: до"
                  value={team.calendar_window_end ?? ""}
                  onCommit={(v) => patch({ calendar_window_end: v || null })}
                />
                <SectionFooter>
                  Видимое время — какие часы показывает сетка. Рабочее время —
                  часы смены бригады; вне их сетка серая.
                </SectionFooter>
                <Divider inset={16} />
                <View className="px-4 pt-2.5">
                  <Text style={{ fontSize: 12, color: t.sub, marginBottom: 8 }}>
                    Буфер между записями
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {BUFFER_OPTIONS.map((o) => (
                      <Chip
                        key={o.label}
                        label={o.label}
                        radio
                        selected={(team.buffer_minutes ?? 0) === (o.v ?? 0)}
                        onPress={() => patch({ buffer_minutes: o.v })}
                        accessibilityLabel={`Буфер ${o.label}`}
                      />
                    ))}
                  </View>
                </View>
                <SectionFooter>
                  Автоматический зазор после каждого визита — дорога, уборка
                  инструмента.
                </SectionFooter>
                <Divider inset={16} />
                <ToggleRow
                  label="Скрывать отменённые"
                  value={!!team.hide_cancelled}
                  onChange={(v) => patch({ hide_cancelled: v || null })}
                />
                <Divider inset={16} />
                <ToggleRow
                  label="Разрешить переработку"
                  hint="Последний визит может закончиться после конца рабочего времени"
                  value={!!team.allow_overtime}
                  onChange={(v) => patch({ allow_overtime: v || null })}
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
                <Divider inset={16} />
                {/* Рабочие часы (team_schedules) — общий старт/конец рабочего
                    дня + автопрокрутка календаря + рабочие дни недели. Отдельно
                    от «видимого окна» календаря выше (calendar_window_*). */}
                <View className="px-4 pb-1 pt-3">
                  <Text style={{ fontSize: 12, color: t.sub }}>Рабочие часы</Text>
                </View>
                <TimeField
                  label="Рабочее время: с"
                  value={sched.start ?? ""}
                  onCommit={(v) =>
                    patchSchedule({ start: v || DEFAULT_SCHEDULE.start })
                  }
                />
                <Divider inset={16} />
                <TimeField
                  label="Рабочее время: до"
                  value={sched.end ?? ""}
                  onCommit={(v) =>
                    patchSchedule({ end: v || DEFAULT_SCHEDULE.end })
                  }
                />
                <Divider inset={16} />
                <TimeField
                  label="Открывается на"
                  value={team.default_scroll_time ?? ""}
                  onCommit={(v) => patch({ default_scroll_time: v || null })}
                />
                <Divider inset={16} />
                <View className="px-4 pb-3 pt-2.5">
                  <Text
                    style={{ fontSize: 12, color: t.sub, marginBottom: 8 }}
                  >
                    Рабочие дни
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {WEEKDAY_KEYS.map((key) => (
                      <Chip
                        key={key}
                        label={WEEKDAY_NAMES[key]}
                        selected={dayWorking(key)}
                        onPress={() => toggleDay(key, !dayWorking(key))}
                        accessibilityLabel={`Рабочий день ${WEEKDAY_NAMES[key]}`}
                      />
                    ))}
                  </View>
                </View>
              </>
            ) : null}
          </SectionCard>
          {/* Футнот всей группы — только когда контролы видны: текст
              объясняет пустые поля/выключенные тумблеры выше. */}
          {calOpen ? (
            <SectionFooter>
              Действует только для этой команды. Пустое поле или выключенный
              тумблер — используется глобальная настройка из «Мой календарь».
            </SectionFooter>
          ) : null}

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
                  // Копия говорит правду о коде ниже: detach сбрасывает
                  // привязку автоматически (web parity — веб тоже сообщает
                  // об авто-сбросе, а не о ручном переназначении).
                  "Команда скроется из списков. Записи и мастера останутся, но их привязка к команде сбросится автоматически.",
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
