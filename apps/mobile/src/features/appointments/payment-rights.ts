import { accessGate } from "@/features/access/my-access";
import type { AccessLevel, MemberAccessMap } from "@/features/access/access-map";
import type { UserRole } from "@/features/settings/role-policy";

// ПРАВА БЛОКА «ОПЛАТА» — В ОДНОМ МЕСТЕ, ЧИСТОЙ ФУНКЦИЕЙ.
//
// Их три, они считаются по разным источникам, и один из них — временный.
// Пока всё это жило внутри самого блока, он перевалил за предел в 400 строк,
// а правило «кто может брать деньги» нельзя было проверить тестом: оно
// стояло посреди разметки.

/** Календарь ленты — только то, что решает право. */
export interface PaymentCalendar {
  teamId: string;
  isActive: boolean;
  grants: readonly string[];
}

export interface PaymentRights {
  /** Завести счёт прямо из шторки оплаты. */
  createAccount: boolean;
  /** Открыть историю платежей записи. */
  seeHistory: boolean;
  /** Принять оплату и снять её. */
  takeMoney: boolean;
}

export interface PaymentRightsInput {
  role: UserRole | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null;
  /** Лента календарей ВОШЕДШЕГО (`list_my_calendars`) — ровно те поля, от
   *  которых зависит право. Тип здесь свой, а не из `workspaces`: тот тянет
   *  react-native, и правило нельзя было бы поднять тестом. */
  myCalendars: readonly PaymentCalendar[];
  /** Карта прав того, чьими глазами смотрят, либо `null` вне режима. */
  mirror: MemberAccessMap | null;
}

export function paymentRights(input: PaymentRightsInput): PaymentRights {
  const { role, map, teamId, myCalendars, mirror } = input;

  const createAccount =
    accessGate({ role: role ?? undefined, map, blockKey: "finance.accounts", scope: "calendar", teamId }) ===
    "write";

  // ИСТОРИЯ ПЛАТЕЖЕЙ ЧИТАЕТ ЖУРНАЛ КОМПАНИИ: без «Доходов и расходов» хотя бы
  // на просмотр сервер строк не отдаст, и значок вёл бы в пустой лист.
  const operations = accessGate({
    role: role ?? undefined,
    map,
    blockKey: "finance.operations",
    scope: "calendar",
    teamId,
  });

  return {
    createAccount,
    seeHistory: operations === "read" || operations === "write",
    takeMoney: takeMoneyRight({ role, map, teamId, myCalendars, mirror }),
  };
}

/** ДЕНЬГИ ПО ЗАПИСИ — ПО ТОМУ ПРАВУ, КОТОРОЕ СЕРВЕР ПРОВЕРЯЕТ СЕГОДНЯ.
 *
 *  Оплата записи принадлежит блоку «Оплата в записи», а он ещё не живой:
 *  уровни финансов её не решают. Поэтому право берётся старое, календарное
 *  (`finance` в ленте `list_my_calendars`): повесить плитки на «Доходы и
 *  расходы» значило бы разъехаться в обе стороны — кому-то они загорелись бы
 *  без права на оплату, кому-то погасли бы при праве.
 *  ВРЕМЕННО: уйдёт на `accessGate({ blockKey: "record.payment", … })`, когда
 *  блок станет живым.
 *
 *  В ЗЕРКАЛЕ СЧИТАЕТСЯ ОТ НЕГО, А НЕ ОТ ВЛАДЕЛЬЦА. Лента — про ВОШЕДШЕГО, и
 *  владельцу сервер ставит `finance` на каждый календарь: в предпросмотре
 *  плитки горели всегда, что бы владелец ни выставил. Точнее ответить нечем —
 *  старый грант виден только самому человеку (`list_members` его владельцу не
 *  отдаёт), — поэтому отвечаем на вопрос, который решает сервер: работает ли
 *  он в этом календаре. */
function takeMoneyRight(input: {
  role: UserRole | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null;
  myCalendars: readonly PaymentCalendar[];
  mirror: MemberAccessMap | null;
}): boolean {
  if (input.role === "owner") return true;

  // ЖИВОЙ БЛОК ПОБЕЖДАЕТ СТАРЫЙ ГРАНТ, И ПЕРЕКЛЮЧАЕТСЯ САМ. Пока сервер
  // `record.payment` не проверяет, его нет в карте прав вовсе
  // (`access_map_for` кладёт только живые блоки) — и правило отвечает старым
  // календарным грантом. В день, когда блок оживёт, ключ появится в карте, и
  // тот же код начнёт слушаться уровня: накат пройдёт без выпуска приложения
  // и без кадра «кнопка была — кнопки нет».
  const live = recordPaymentLevel(input.mirror ?? input.map, input.teamId);
  if (live !== null) return live === "write";

  if (input.mirror) {
    // Блок ещё спит: точнее «работает ли он в этом календаре» предпросмотру
    // ответить нечем — старый грант виден только самому человеку.
    return input.teamId !== null && input.mirror.attachedCalendars.includes(input.teamId);
  }
  return input.myCalendars.some(
    (calendar) =>
      calendar.isActive &&
      calendar.teamId === input.teamId &&
      calendar.grants.includes("finance"),
  );
}

/** Уровень «Оплаты в записи» в этом календаре, либо `null` — блока в карте
 *  нет, то есть сервер его ещё не проверяет. */
function recordPaymentLevel(
  map: MemberAccessMap | null | undefined,
  teamId: string | null,
): AccessLevel | null {
  if (!map || teamId === null) return null;
  return map.calendars[teamId]?.["record.payment"] ?? null;
}
