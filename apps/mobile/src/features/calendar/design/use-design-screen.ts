import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useTeams, useUpdateTeam } from "@/features/reference/queries";
import {
  CANCELLED_DEFAULT,
  PAID_DEFAULT,
  PREPAID_DEFAULT,
  SITUATION_DEFAULTS,
  useCancelledColor,
  usePaidColor,
  usePrepaidColor,
  useAutoColorRule,
  useBookingBlocks,
  useEventBlockOrder,
  useEventBlocks,
  useFallbackColor,
  useRecordBlockOrder,
  useSetAutoColorRule,
  useSetSituationColor,
  useRememberedColor,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
  type BookingBlockId,
  type EventBlockId,
} from "@/features/appointments/booking-prefs";
import { useCalendarSettings, usePersonalEventTypes } from "@/features/settings/local-settings";
import { useDataRole, usePlanAllows } from "@/session/tenant";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { useMemberUpdateTeam } from "@/features/calendar/mutations";
import { useTeamSettingLevel } from "@/session/team-setting-level";
import { COLOR_SITUATIONS } from "@/features/appointments/record-color";
import { designColorRows, eventTypesSubtitle, type ColorTarget } from "./design-rows";

/** Team, rights, colours and blocks of the «Записи» page. */
export function useDesignScreen() {
  const router = useRouter();
  // «ДИЗАЙН» — У КАЖДОЙ КОМАНДЫ СВОЙ. Команда едет адресом из
  // настроек календаря; без неё — первая.
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: allTeams = [] } = useTeams();
  const team = allTeams.find((x) => x.id === params.team) ?? allTeams[0];
  const teamId = team?.id ?? null;
  // «ТОЛЬКО ВИДИТ» — СТРАНИЦА БЕЗ ПРАВКИ (право «Записи» в
  // «Настройках команды»). Владельцу — всегда правка.
  const readOnly = useTeamSettingLevel("calendar.booking_form", teamId) !== "write";
  // Строку команды (её цвет, «Скрывать отменённые») сотрудник пишет своей
  // дверью `member_update_team` — по тому же праву «Записи».
  const isMaster = useDataRole().data === "master";
  const memberUpdateTeam = useMemberUpdateTeam();

  // ── цвет ──
  const rule = useAutoColorRule(teamId);
  const setRule = useSetAutoColorRule(teamId);
  const palette = useSituationPalette(teamId);
  const setSituationColor = useSetSituationColor(teamId);
  const rememberedColor = useRememberedColor(teamId);
  const fallback = useFallbackColor(teamId);
  const [editingColor, setEditingColor] = useState<ColorTarget | null>(null);
  const cancelledColor = useCancelledColor(teamId);
  const paidColor = usePaidColor(teamId);
  const prepaidColor = usePrepaidColor(teamId);

  // ── блоки ──
  const recordBlocks = useBookingBlocks(teamId);
  const toggleRecordBlock = useToggleBookingBlock(teamId);
  const eventBlocks = useEventBlocks(teamId);
  const toggleEventBlock = useToggleEventBlock(teamId);
  const objectsOn = recordBlocks.includes("object");
  // ПОРЯДОК БЛОКОВ редактирует сам человек (например, объект первым, клиент
  // вторым). Пока строку тянут, страница не едет.
  const recordOrder = useRecordBlockOrder(teamId);
  const eventOrder = useEventBlockOrder(teamId);
  const [dragging, setDragging] = useState(false);
  const saveOrderError = (e: Error) => notify("Не удалось сохранить порядок", e.message);

  // ── типы событий ──
  const typesQuery = usePersonalEventTypes(teamId);
  const typesSub = eventTypesSubtitle(typesQuery.isLoading, typesQuery.data ?? []);

  // ВСЁ ЗАПОЛНЕНО — ЦВЕТОМ КОМАНДЫ: выбирается просто цвет, в какой красить,
  // когда всё заполнено. Выбор здесь и есть цвет команды: так он один на сетку, ленту команд и
  // её записи.
  const ordinary = team?.color || fallback;
  const updateTeam = useUpdateTeam();

  // «СКРЫВАТЬ ОТМЕНЁННЫЕ» — ЗДЕСЬ, НА «КЛИЕНТЕ». Пишется в КОМАНДУ (`teams.hide_cancelled`), как всё на этой
  // странице: календарь и так читает сперва её, а старое значение компании
  // (`calendar_settings`) — только пока у команды своего нет. Тумблер ставит
  // явное да/нет, не `null`: «как у компании» отсюда уже не выбрать.
  const companyHides = !!useCalendarSettings().data?.hideCancelled;
  const [hidesNow, setHidesNow] = useState<boolean | null>(null);
  const hidesCancelled = hidesNow ?? team?.hide_cancelled ?? companyHides;
  const setHidesCancelled = (next: boolean) => {
    if (!team || readOnly) return;
    haptics.tap();
    setHidesNow(next);
    const done = {
      onSettled: () => setHidesNow(null),
      onError: (e: Error) => notify("Ошибка", e.message),
    };
    if (isMaster) {
      memberUpdateTeam.mutate({ teamId: team.id, patch: { hide_cancelled: next } }, done);
    } else {
      updateTeam.mutate({ id: team.id, patch: { hide_cancelled: next } }, done);
    }
  };

  // ПЕРЕКЛЮЧАТЕЛЬ СТРАНИЦЫ: «Клиент» — цвет записи и её
  // блоки, «Событие» — блоки события и типы; открывается «Клиент».
  //
  // БЕЗ ТАРИФА КЛИЕНТОВ НЕТ: «Клиент» серый, тап — плашка
  // тарифа; страница стоит на «Событии».
  // Тариф — у этого календаря: у каждого своя оплата.
  const clientsInPlan = usePlanAllows("book-clients", team?.id ?? null);
  const nudgeTariff = useTariffNudge(team?.id ?? null);
  const [pickedTab, setTab] = useState<"record" | "event" | null>(null);
  const tab = clientsInPlan ? (pickedTab ?? "record") : "event";
  const openColor = (target: ColorTarget) => {
    if (readOnly) return;
    haptics.tap();
    setEditingColor(target);
  };

  // Строки цвета и когда каждая срабатывает — `design-rows.ts`.
  const colorRows = designColorRows({
    ordinary,
    objectsOn,
    paymentOn: recordBlocks.includes("payment"),
    palette,
    cancelled: cancelledColor,
    paid: paidColor,
    prepaid: prepaidColor,
    rule,
  });

  const colorSheetTitle =
    editingColor === "filled"
      ? "Обычный цвет"
      : editingColor === "cancelled"
        ? "Отменена"
        : editingColor === "paid"
          ? "Оплачено"
          : editingColor === "prepaid"
            ? "Предоплата"
            : COLOR_SITUATIONS.find((s) => s.id === editingColor)?.label;
  const colorSheetValue =
    editingColor === "filled"
      ? ordinary
      : editingColor === "cancelled"
        ? cancelledColor
        : editingColor === "paid"
          ? paidColor
          : editingColor === "prepaid"
            ? prepaidColor
            : editingColor
            ? palette[editingColor] ?? null
            : null;
  // ВЫКЛЮЧАТЕЛЬ СЛУЧАЯ. Выключили — такая запись красится обычным цветом, а
  // свой цвет случая запоминается; включили — возвращается он (заводской —
  // только если своего не было).
  const toggleColor = (target: ColorTarget, next: boolean) => {
    if (readOnly || target === "filled") return;
    haptics.tap();
    const factory =
      target === "cancelled"
        ? CANCELLED_DEFAULT
        : target === "paid"
          ? PAID_DEFAULT
          : target === "prepaid"
            ? PREPAID_DEFAULT
            : SITUATION_DEFAULTS[target];
    const current =
      target === "cancelled"
        ? cancelledColor
        : target === "paid"
          ? paidColor
          : target === "prepaid"
            ? prepaidColor
            : palette[target] ?? null;
    if (next) {
      setSituationColor.mutate({ situation: target, color: rememberedColor(target) ?? factory });
    } else {
      setSituationColor.mutate({ situation: target, color: null, remember: current });
    }
  };

  const recordOn = (id: string) => recordBlocks.includes(id as BookingBlockId);
  const eventOn = (id: string) => eventBlocks.includes(id as EventBlockId);

  return {
    router,
    team,
    teamId,
    readOnly,
    isMaster,
    memberUpdateTeam,
    rule,
    setRule,
    palette,
    setSituationColor,
    editingColor,
    setEditingColor,
    toggleRecordBlock,
    toggleEventBlock,
    objectsOn,
    recordOrder,
    eventOrder,
    dragging,
    setDragging,
    saveOrderError,
    typesSub,
    ordinary,
    updateTeam,
    hidesCancelled,
    setHidesCancelled,
    clientsInPlan,
    nudgeTariff,
    tab,
    setTab,
    openColor,
    colorRows,
    colorSheetTitle,
    colorSheetValue,
    toggleColor,
    recordOn,
    eventOn,
  };
}
