import { Linking } from "react-native";
import { confirmAction } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import type { Appointment } from "@babun/shared/local/appointments";
import { humanDayTitle } from "@/features/appointments/helpers";
import { isCalendarEvent } from "@/features/calendar/event-access";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { QuickEvents } from "./use-quick-events";
import type { RecordActions } from "./use-record-actions";
import type { RecordNaming } from "./use-record-naming";

type CreateActionMenuDeps =
  Pick<RecordActions, "openEdit" | "openReminderMenu" | "startFreeMove" | "startMove"
    | "setCancelled" | "cancelWithReason" | "deleteAppointmentConfirmed">
  & Pick<CalendarSources, "clients">
  & Pick<CalendarRights, "canMutateAppointment" | "isCrew" | "smsInPlan" | "actionsIn"
    | "actorId" | "eventRightsIn" | "workInPlan" | "nudgeTariff">
  & Pick<CalendarClock, "todayYmd">
  & Pick<CalendarUiState, "setSmsApt" | "setSmsOpen" | "setRecolor" | "setSheetMenu">
  & Pick<QuickEvents, "copyInPlace">
  & Pick<RecordNaming, "clientName">;

/** The long-press menu of a record: what the viewer may do with it. */
export function createActionMenu(deps: CreateActionMenuDeps) {
  const {
    openEdit, clients, canMutateAppointment, isCrew, todayYmd, openReminderMenu,
    smsInPlan, setSmsApt, setSmsOpen, actionsIn, actorId, startFreeMove, startMove,
    eventRightsIn, setRecolor, setCancelled, cancelWithReason,
    deleteAppointmentConfirmed, copyInPlace, workInPlan, nudgeTariff, setSheetMenu,
    clientName,
  } = deps;
  // ─── Контекстное меню записи (долгое нажатие без движения) ──────────
  // Web parity ActionMenuModal (dashboard/page.tsx:1752): «только действия,
  // которыми реально пользуются». Рисует канонический нижний лист через
  // chooseOption: ActionSheetIOS существует ТОЛЬКО на iOS, в браузере его
  // вызов падал с TypeError и уносил всё меню записи. Необратимое удаление
  // подтверждается отдельно.
  const openActionMenu = (apt: Appointment) => {
    // Виртуальное вхождение повтора: быстрые действия валидны только для
    // seed — открываем карточку (openEdit сам маршрутизирует на исходную).
    if ((apt as { virtualParentId?: string }).virtualParentId) {
      openEdit(apt);
      return;
    }
    haptics.tap();
    const client = apt.client_id
      ? clients.find((c) => c.id === apt.client_id)
      : undefined;
    const phone = (client?.phone ?? "").trim();
    const address = (apt.address || client?.address || "").trim();
    const event = isCalendarEvent(apt);
    const mutable = canMutateAppointment(apt);
    // Отменённую с возвратом оплаты не восстановить: сервер не меняет
    // возвращённую оплату («создайте новую заявку») — пункт кончался бы
    // отказом всегда.
    const restorable =
      apt.status !== "cancelled" || apt.payment_status !== "refunded";
    // ПЕРВОЕ СОБЫТИЕ СЕРИИ — САМА СЕРИЯ (повторный аудит 03.10): его перенос
    // сдвигает все повторы, а на день вне правила блок просто исчезал. У
    // удаления вопрос был всегда; теперь — и у переноса.
    const repeating = !!apt.event_repeat && apt.event_repeat.kind !== "none";
    const wholeSeries = (run: () => void) => () =>
      repeating
        ? void confirmAction("Перенести всю серию?", {
            message: "Это первое событие серии: вместе с ним сдвинутся все его повторы.",
            confirmLabel: "Перенести серию",
          }).then((ok) => {
            if (ok) run();
          })
        : run();

    /** `view` — пункт ничего не меняет в записи (открыть, позвонить, SMS…). */
    type Item = { label: string; run: () => void; destructive?: boolean; view?: true };
    const items: Item[] = [];
    if (isCrew) {
      items.push({
        label: event ? "Открыть событие" : "Открыть запись",
        run: () => openEdit(apt),
        view: true,
      });
      // «В работу» / «Выполнена» убраны вместе со статусом (владелец 03.10:
      // «статус удаляй полностью»); визит закрывает оплата.
      // Локальное напоминание доступно и для командного события в режиме
      // просмотра: это настройка устройства, она не изменяет чужую запись.
      if (apt.status !== "cancelled" && apt.date >= todayYmd)
        items.push({ label: "Напомнить…", run: () => openReminderMenu(apt), view: true });
      if (phone && !event && smsInPlan)
        items.push({
          label: "Отправить SMS",
          run: () => {
            setSmsApt(apt);
            setSmsOpen(true);
          },
          view: true,
        });
      if (phone)
        items.push({
          label: "Позвонить",
          run: () => Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`),
          view: true,
        });
      if (address)
        items.push({
          label: "Маршрут",
          run: () =>
            Linking.openURL(
              `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`,
            ),
          view: true,
        });
      // ДЕЙСТВИЯ ПО ПРАВАМ (STORY-088): каждое — свой блок в календаре
      // записи; нет права — нет пункта. Своё событие при «События: Меняет»
      // двигают, красят и удаляют; рабочую запись — по «Перенос записей» и
      // «Отменять и удалять».
      //
      // «ПЕРЕНОС ЗАПИСЕЙ» — ВСЁ МЕНЮ ЗАПИСИ (владелец 30.09: «перенос — значит
      // свободное перемещение, перенести, копировать, цвет»), и всё — только
      // внутри команды записи: перенос не меняет её команду, копия
      // делается на сервере в ту же команду (`member_appointment_copy`).
      const can = actionsIn(apt.team_id ?? null);
      const ownEvent =
        event && can.events === "write" && !!actorId && apt.created_by === actorId;
      const movable =
        apt.status !== "cancelled" &&
        apt.event_all_day !== true &&
        (event ? ownEvent : can.move);
      if (movable && !event)
        items.push({
          label: "Свободное перемещение",
          run: () => startFreeMove(apt),
        });
      if (movable) items.push({ label: "Перенести", run: wholeSeries(() => startMove(apt)) });
      if (!event && can.move && apt.event_all_day !== true)
        items.push({ label: "Копировать", run: () => startMove(apt, "copy") });
      // Цвет события — его блок «Тип» (название и цвет): без «Меняет»
      // сервер отказывает (аудит 03.10). Отменённой цвет не нужен: она всегда
      // серая пунктиром, и выбранный цвет на сетке ничего не менял.
      if (
        apt.status !== "cancelled" &&
        (event ? ownEvent && eventRightsIn(apt.team_id ?? null).type === "write" : can.color)
      )
        items.push({ label: "Цвет", run: () => setRecolor(apt) });
      if (!event && can.cancel && restorable)
        items.push(
          apt.status === "cancelled"
            ? { label: "Восстановить", run: () => setCancelled(apt, null) }
            : { label: "Отменить визит", run: () => cancelWithReason(apt) },
        );
      if (event ? ownEvent : can.cancel)
        items.push({
          label: event ? "Удалить событие" : "Удалить запись",
          destructive: true,
          run: () => deleteAppointmentConfirmed(apt),
        });
    } else {
      // МИНИ-МЕНЮ ДИСПЕТЧЕРА — ЧЕТЫРЕ ДЕЙСТВИЯ (владелец 2026-09-06: «долгое
      // нажатие открывает перенести — кубики зелёные, куда можно перевести по
      // всей таблице; потом копировать; потом отменить, удалить»). «Открыть»,
      // оплата, статусы, звонок и маршрут отсюда ушли: тап открывает запись,
      // деньги и статус живут в её блоке «Оплата», звонок и маршрут — в шапке.
      // Перенос отменённой бессмыслен — сначала «Восстановить»; «весь день»
      // кубиками не ставится — дату ему меняют на странице записи.
      if (
        apt.status !== "cancelled" &&
        apt.event_all_day !== true &&
        (!event || mutable)
      ) {
        items.push({
          label: "Свободное перемещение",
          run: wholeSeries(() => startFreeMove(apt)),
        });
        items.push({ label: "Перенести", run: wholeSeries(() => startMove(apt)) });
      }
      items.push({
        label: "Копировать",
        // «Весь день» кубиками не ставится (его окно — сутки): копия встаёт
        // на тот же день и открывается на правку, как раньше.
        run: () =>
          apt.event_all_day === true ? copyInPlace(apt) : startMove(apt, "copy"),
      });
      // ОТМЕНЁННОЙ — БЕЗ «ЦВЕТА» (повторный аудит 03.10, на симуляторе):
      // отменённая запись всегда серая пунктиром, выбранный цвет на сетке не
      // показывался — пункт, который ничего не меняет.
      if ((!event || mutable) && apt.status !== "cancelled")
        items.push({ label: "Цвет", run: () => setRecolor(apt) });
      if (!event && phone && smsInPlan)
        items.push({
          label: "Отправить SMS",
          run: () => {
            setSmsApt(apt);
            setSmsOpen(true);
          },
          view: true,
        });
      if (!event) {
        if (restorable)
          items.push(
            apt.status === "cancelled"
              ? { label: "Восстановить", run: () => setCancelled(apt, null) }
              : { label: "Отменить визит", run: () => cancelWithReason(apt) },
          );
      }
      if (mutable)
        items.push({
          // Явный null-чек: у одиночного события event_repeat = null, и
          // «undefined !== "none"» обещал бы удаление несуществующей серии.
          label: event
            ? apt.event_repeat && apt.event_repeat.kind !== "none"
              ? "Удалить серию"
              : "Удалить событие"
            : "Удалить запись",
          destructive: true,
          run: () => deleteAppointmentConfirmed(apt),
        });
    }

    // Шапка — кто, подпись — когда. Действие ждёт ухода листа сам
    // `PickerSheet`: почти каждый пункт открывает своё окно.
    // БЕЗ ТАРИФА ЗАПИСЬ КЛИЕНТА — ТОЛЬКО ДЛЯ ПРОСМОТРА (аудит 03.10): сервер
    // (`appointments_free_readonly`) отклоняет любую её правку, а меню
    // предлагало перенос, цвет, статус, копию и удаление — и каждое кончалось
    // откатом с ошибкой сервера. Пункты остаются, тап — плашка «Нужно
    // изменить тариф», как на странице записи.
    const shown =
      !event && !workInPlan
        ? items.map((item) => (item.view ? item : { ...item, run: nudgeTariff }))
        : items;

    setSheetMenu({
      title: clientName(apt) || apt.comment || "Запись",
      subtitle: `${humanDayTitle(apt.date)}, ${apt.time_start}–${apt.time_end}`,
      items: shown,
    });
  };

  return openActionMenu;
}

export type OpenActionMenu = ReturnType<typeof createActionMenu>;
