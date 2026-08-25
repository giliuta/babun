import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarClock,
  ChevronRight,
  MapPin,
  Package,
  Users as UsersIcon,
  Wrench,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { Divider } from "@/components/ui/Divider";
import { NameColorField } from "@/components/ui/picker-fields";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  teamCities,
  teamMembers,
  useMasters,
  useTeam,
  useUpdateTeam,
} from "@/features/reference/queries";
import { useServices } from "@/features/services/queries";
import { FORMS_USLUGA, formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { schedulePreview } from "@/features/calendar/schedule-days";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";

// ─── Brigade hub ─────────────────────────────────────────────────────
// Хаб про ЛЮДЕЙ: имя и цвет, мастера, услуги, оборудование, метки, «активна»
// и удаление. Настройки календаря сюда больше не лезут — у них свой экран
// (/calendar), а здесь только строка-выход в него. Раньше половина
// календарных полей жила тут под аккордеоном «Часы и поведение», а вторая
// половина — в другом разделе приложения.

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

export default function TeamHubScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamQuery = useTeam(id);
  const mastersQuery = useMasters();
  const { data: team } = teamQuery;
  const masters = mastersQuery.data ?? [];
  // Для value-превью «Услуги» — тот же источник, что у веб-хаба
  // (servicesPreview в teams/[id]/page.tsx): привязка живёт в
  // services.brigade_ids, у команды своей колонки нет.
  const servicesQuery = useServices();
  const scheduleQuery = useTeamSchedule(id);
  const services = servicesQuery.data ?? [];
  const schedule = scheduleQuery.data;
  const update = useUpdateTeam();

  const [name, setName] = useState<string | null>(null);
  const [payout, setPayout] = useState<string | null>(null);

  const loading =
    teamQuery.isLoading ||
    mastersQuery.isLoading ||
    servicesQuery.isLoading ||
    scheduleQuery.isLoading;
  const readError =
    teamQuery.error ||
    mastersQuery.error ||
    servicesQuery.error ||
    scheduleQuery.error;

  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Команда" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Команда" />
        <EmptyState
          state="error"
          title="Не удалось загрузить команду"
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([
                teamQuery.refetch(),
                mastersQuery.refetch(),
                servicesQuery.refetch(),
                scheduleQuery.refetch(),
              ]),
          }}
          fill
        />
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
      { onError: (e) => notify("Ошибка", e.message) },
    );
  };

  // Превью строки «Календарь» — рабочий график: единственное, чем календари
  // отличаются друг от друга.
  const calendarPreview = schedule
    ? schedulePreview(schedule)
    : "Как везде";

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

  const commitPayout = () => {
    if (payout === null) return;
    const next = Number(payout.trim().replace(",", "."));
    if (!Number.isFinite(next) || next < 0 || next > 100) {
      setPayout(null);
      notify("Некорректная доля", "Введите число от 0 до 100 процентов.");
      return;
    }
    const rounded = Math.round(next * 100) / 100;
    if (rounded !== Number(team.payout_percentage ?? 0)) {
      patch({ payout_percentage: rounded });
    }
    setPayout(null);
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

  // ── Услуги команды. С 2026-08-17 услуга принадлежит РОВНО одной команде,
  // поэтому «не заданы — доступны все» больше не бывает: пустой прайс значит
  // пустой прайс, и записать работу на такую команду нельзя.
  const teamServicesCount = services.filter((s) => s.team_id === team.id).length;
  const servicesPreview =
    teamServicesCount === 0 ? "Прайс пуст" : formatCountRu(teamServicesCount, FORMS_USLUGA);

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
          {/* ИМЯ И ЦВЕТ БРИГАДЫ — ОДНА СТРОКА, как у услуги и у календаря
              (владелец 2026-08-18). Здесь стояла своя вёрстка: точка-кнопка,
              своё поле ввода с литералами и шеврон, раскрывающий палитру
              внутрь карточки, — третий способ спросить то же самое. Имя
              коммитится по завершении ввода, цвет — сразу по выбору. */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <NameColorField
              label="Название команды"
              name={nameDraft}
              onNameChange={setName}
              onBlur={commitName}
              color={team.color}
              onColorChange={(hex) => patch({ color: hex })}
            />
          </View>

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

          {/* Календарь — одна строка-выход. Настройки календаря живут на
              /calendar/[teamId]: одно место на настройку, а не аккордеон
              здесь и половина тех же полей в другом разделе. */}
          <SectionCard className="mt-5">
            <NavRow
              icon={<CalendarClock color={t.accent} size={ICON.md} />}
              title="Календарь"
              value={calendarPreview}
              onPress={() => router.push(`/calendar?team=${team.id}`)}
            />
          </SectionCard>

          <SectionCard className="mt-5" title="Финансы" padded>
            <Field
              label="Доля команды, %"
              value={payout ?? String(team.payout_percentage ?? 0)}
              onChangeText={setPayout}
              onBlur={commitPayout}
              onSubmitEditing={commitPayout}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <Text className="-mt-2 mb-1 text-xs" style={{ color: t.faint }}>
              Используется для расчёта выплаты команде по выполненным работам.
            </Text>
          </SectionCard>

          {/* Активна */}
          <SectionCard className="mt-5">
            <SwitchRow
              label="Команда активна"
              hint={
                team.is_active
                  ? "Показывается в списках, календаре и выборе."
                  : "Скрыта — можно вернуть в любой момент."
              }
              value={team.is_active}
              onChange={(active) => {
                if (active) {
                  patch({ is_active: true });
                  return;
                }
                confirmThen(
                  `Архивировать «${team.name}»?`,
                  {
                    message: "Команда исчезнет из рабочих списков, но вся история заявок и финансов сохранится.",
                    confirmLabel: "Архивировать",
                  },
                  () => patch({ is_active: false }),
                );
              }}
            />
          </SectionCard>

          <Text
            className="mx-5 mt-3 text-center text-xs"
            style={{ color: t.faint }}
          >
            Архивирование сохраняет историю заявок, сотрудников и финансов команды.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
