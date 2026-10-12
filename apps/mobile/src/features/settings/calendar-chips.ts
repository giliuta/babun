// СОСТАВ И ПОРЯДОК ЛЕНТЫ КАЛЕНДАРЕЙ — ЧИСТАЯ ФУНКЦИЯ В ЛИСТЕ.
//
// Лист намеренно не импортирует ни react-native, ни supabase: раннер тестов их
// не поднимает, и пока эта логика жила внутри хука, проверить её можно было
// только снимком экрана. А снимок гонку не ловит: дубль в ленте жил 50–100 мс
// сразу после перехода, и серия скриншотов, снятая «одновременно» с тапом,
// показала состояние ДО тапа — вызовы выполняются по очереди. Такое проверяется
// только функцией и тестом.

/** Чужой чип носит компанию в идентификаторе: пара (компания, календарь) —
 *  настоящий ключ, в базе у команд именно такой первичный ключ. Без компании
 *  два календаря с одинаковым id из разных компаний слиплись бы в один. */
export const FOREIGN_PREFIX = "@";

export interface CalendarChip {
  id: string;
  name: string;
  color?: string | null;
}

/** Ровно то, что ленте нужно от календаря человека, — не весь `MyCalendar`. */
export interface ChipSourceCalendar {
  tenantId: string;
  tenantName: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  /** Флаг СЕРВЕРА «это активная компания» на момент ответа. Сразу после
   *  перехода он устаревает — см. `activeTenantId`. */
  isActive: boolean;
}

export function composeCalendarChips(input: {
  /** Календари активной компании — как их знает экран (с архивными). */
  own: readonly { id: string; name: string; color?: string | null }[];
  myCalendars: readonly ChipSourceCalendar[];
  /** Компания УСТРОЙСТВА. Меняется в том же кадре, что и тап, и сети не
   *  требует. `null` — ещё не известна. */
  activeTenantId: string | null;
  /** Порядок человека (`user_calendar_order`): ключи `calendarOrderKey`. */
  order?: readonly string[] | null;
}): CalendarChip[] {
  return applyCalendarOrder(composeDefault(input), input.activeTenantId, input.order);
}

/** Ключ календаря в порядке человека: компания и команда — один и тот же по
 *  обе стороны перехода между аккаунтами (у своего чипа компании в id нет). */
export function calendarOrderKey(chipId: string, activeTenantId: string | null): string | null {
  if (chipId.startsWith(FOREIGN_PREFIX)) return chipId.slice(FOREIGN_PREFIX.length);
  return activeTenantId ? `${activeTenantId}:${chipId}` : null;
}

/** ПОРЯДОК ЧЕЛОВЕКА (владелец 11.10: «чтоб можно менять местами календари»).
 *  Названные — в его порядке; не названные (новый календарь, порядок ещё не
 *  задан) — следом, в заводском порядке. Компания устройства ещё не известна
 *  — заводской: свои чипы без компании не сопоставить. */
export function applyCalendarOrder(
  chips: CalendarChip[],
  activeTenantId: string | null,
  order: readonly string[] | null | undefined,
): CalendarChip[] {
  if (!order || order.length === 0 || !activeTenantId) return chips;
  const rank = new Map(order.map((key, i) => [key, i]));
  const at = (chip: CalendarChip) => {
    const key = calendarOrderKey(chip.id, activeTenantId);
    return key != null && rank.has(key) ? (rank.get(key) as number) : Infinity;
  };
  return chips
    .map((chip, i) => ({ chip, i, r: at(chip) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.chip);
}

function composeDefault(input: {
  own: readonly { id: string; name: string; color?: string | null }[];
  myCalendars: readonly ChipSourceCalendar[];
  activeTenantId: string | null;
}): CalendarChip[] {
  // СВОЁ И ЧУЖОЕ — ОТ КОМПАНИИ УСТРОЙСТВА, А НЕ ОТ ФЛАГА СЕРВЕРА. Сразу после
  // тапа список ещё прежний: в нём «активна» компания, откуда человек ушёл.
  // Строй ряд по флагу — и свои календари новой компании встанут дважды
  // (заливкой из экрана и обводкой из списка), а календари покидаемой
  // исчезнут. Флаг остаётся запасным путём только пока компания устройства
  // неизвестна: пометить тогда чужими ВСЕ календари значило бы задвоить свои.
  const isActiveCompany = (c: ChipSourceCalendar): boolean =>
    input.activeTenantId ? c.tenantId === input.activeTenantId : c.isActive;

  const ownChips: CalendarChip[] = input.own.map((tm) => ({
    id: tm.id,
    name: tm.name,
    color: tm.color,
  }));
  const foreign = input.myCalendars.filter((c) => !isActiveCompany(c));
  if (foreign.length === 0) return ownChips;

  // ПОРЯДОК НЕ ЗАВИСИТ ОТ ТОГО, ГДЕ ЧЕЛОВЕК СЕЙЧАС (владелец 2026-09-12: «не
  // должно прыгать вправо-влево»). Компании по имени, внутри компании — как
  // пришло. Где человек сейчас, говорит заливка, а не место в ряду. Имени нет
  // (в активной компании ни одного неархивного календаря) — свои встают
  // первыми: пустая строка сортируется раньше любой.
  const activeTenantName =
    input.myCalendars.find(isActiveCompany)?.tenantName ?? "";
  const byTenant = new Map<string, CalendarChip[]>();
  byTenant.set(activeTenantName, ownChips);
  for (const c of foreign) {
    const chips = byTenant.get(c.tenantName) ?? [];
    chips.push({
      id: `${FOREIGN_PREFIX}${c.tenantId}:${c.teamId}`,
      name: c.teamName,
      color: c.teamColor,
    });
    byTenant.set(c.tenantName, chips);
  }
  return [...byTenant.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .flatMap(([, chips]) => chips);
}
