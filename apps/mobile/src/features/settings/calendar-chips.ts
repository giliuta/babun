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
  /** Чип чужой компании — рисуется обводкой, а не заливкой. Поле объявлено
   *  здесь, а не дописывается к объекту молча: лента его читает, и тип обязан
   *  об этом знать. */
  outline?: boolean;
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
      outline: true,
    });
    byTenant.set(c.tenantName, chips);
  }
  return [...byTenant.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .flatMap(([, chips]) => chips);
}
