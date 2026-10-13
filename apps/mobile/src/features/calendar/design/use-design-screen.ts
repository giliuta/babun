import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useTeams, useUpdateTeam } from "@/features/reference/queries";
import {
  useAutoColorRule,
  useBookingBlocks,
  useEventBlockOrder,
  useEventBlocks,
  useFallbackColor,
  useRecordBlockOrder,
  useSetAutoColorRule,
  useSetSituationColor,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
  type BookingBlockId,
  type EventBlockId,
} from "@/features/appointments/booking-prefs";
import { useCalendarSettings, usePersonalEventTypes } from "@/features/settings/local-settings";
import { useDataRole, usePlanAllows } from "@/features/settings/tenant";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { useMemberUpdateTeam } from "@/features/calendar/mutations";
import { useTeamSettingLevel } from "@/features/calendar/team-setting-level";
import { designColorRows, eventTypesSubtitle, type ColorTarget } from "./design-rows";

/** Team, rights, colours and blocks of the «Записи» page. */
export function useDesignScreen() {
  const router = useRouter();
  // «ДИЗАЙН» — У КАЖДОЙ КОМАНДЫ СВОЙ (владелец 24.09). Команда едет адресом из
  // настроек календаря; без неё — первая.
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: allTeams = [] } = useTeams();
  const team = allTeams.find((x) => x.id === params.team) ?? allTeams[0];
  const teamId = team?.id ?? null;
  // «ТОЛЬКО ВИДИТ» — СТРАНИЦА БЕЗ ПРАВКИ (владелец 30.09: «Записи» в
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
  const fallback = useFallbackColor(teamId);
  const [editingColor, setEditingColor] = useState<ColorTarget | null>(null);

  // ── блоки ──
  const recordBlocks = useBookingBlocks(teamId);
  const toggleRecordBlock = useToggleBookingBlock(teamId);
  const eventBlocks = useEventBlocks(teamId);
  const toggleEventBlock = useToggleEventBlock(teamId);
  const objectsOn = recordBlocks.includes("object");
  // ПОРЯДОК БЛОКОВ (владелец 11.10: «поставить первым объект, вторым клиент
  // и самому редактировать»). Пока строку тянут, страница не едет.
  const recordOrder = useRecordBlockOrder(teamId);
  const eventOrder = useEventBlockOrder(teamId);
  const [dragging, setDragging] = useState(false);
  const saveOrderError = (e: Error) => notify("Не удалось сохранить порядок", e.message);

  // ── типы событий ──
  const typesQuery = usePersonalEventTypes(teamId);
  const typesSub = eventTypesSubtitle(typesQuery.isLoading, typesQuery.data ?? []);

  // ВСЁ ЗАПОЛНЕНО — ЦВЕТОМ КОМАНДЫ (владелец 25.09: «убери „красить по“ —
  // просто выбор самого цвета, в какой красить, когда всё заполнено»).
  // Выбор здесь и есть цвет команды: так он один на сетку, ленту команд и
  // её записи.
  const ordinary = team?.color || fallback;
  const updateTeam = useUpdateTeam();

  // «СКРЫВАТЬ ОТМЕНЁННЫЕ» — ЗДЕСЬ, НА «КЛИЕНТЕ» (владелец 30.09: «скрывать
  // отменённые закинем именно в блок клиентов»; раньше — последний тумблер
  // шестерёнки). Пишется в КОМАНДУ (`teams.hide_cancelled`), как всё на этой
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

  // ПЕРЕКЛЮЧАТЕЛЬ СТРАНИЦЫ (владелец 25.09): «Клиент» — цвет записи и её
  // блоки, «Событие» — блоки события и типы; открывается «Клиент».
  //
  // БЕЗ ТАРИФА КЛИЕНТОВ НЕТ (владелец 04.10: «если нет тарифа, открывает
  // сразу события, а клиента не может открыть»): «Клиент» серый, тап — плашка
  // тарифа; страница стоит на «Событии».
  const clientsInPlan = usePlanAllows("book-clients");
  const nudgeTariff = useTariffNudge();
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
  });

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
    recordOn,
    eventOn,
  };
}
