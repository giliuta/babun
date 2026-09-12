import { useMemo, type ReactElement } from "react";
import { Pressable, Text, type RefreshControlProps } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import { DEBT_DIRECTION_LABEL } from "@babun/shared/local/finance/debt";
import { useThemeColors } from "@/theme/colors";
import { panelCount } from "./PanelHeader";
import { RecordRowsPanel } from "./RecordRowsPanel";
import { debtRows, manualDebtRows, mergeDebtRows } from "./debt-rows";
import type { RecordRow } from "./record-rows";

// «Долги» panel — port of the web DebtorsList
// (apps/web/src/components/finance/DebtorsList.tsx): completed-but-unpaid
// appointments for the active team in the period, client + outstanding sum.
// The outstanding sum comes from the shared getDebtAmount (prepaid +
// payments[]) — the authoritative per-visit balance. payment_status /
// paid_amount now round-trip through the repository (W4), but the
// payments[] ledger stays the source of truth for the owed figure.
//
// СВЯЗЬ С ДОЛЖНИКОМ ЖИВЁТ В ЗАПИСИ, А НЕ В СПИСКЕ (владелец 2026-09-09: «не
// надо иконку напомнить — я зайду на клиента, оно перекинет меня в запись, и
// я сам решу, связываться с ним или нет»). Строка отвечает на «кто и сколько»,
// а звонить или писать — решение, которое принимают, уже открыв запись; SMS о
// долге по-прежнему собирается в карточке клиента (ClientContactRow).
//
// Тап по строке открывает САМУ ЗАПИСЬ — долг по канону владельца закрывается
// в ней; карточка клиента осталась второй дверью на long-press.
export function DebtorsList({
  appointments,
  clients,
  services,
  teamId,
  fromDate,
  toDate,
  todayYmd,
  invoicedAppointmentIds,
  debts,
  paidTotals,
  categories,
  direction,
  onDirectionChange,
  onEditDebt,
  onOpenDocuments,
  refreshControl,
}: {
  appointments: Appointment[];
  clients: Client[];
  /** Каталог услуг — строка долга называет работы, за которые не заплатили. */
  services: readonly { id: string; name: string }[];
  teamId: string | null;
  fromDate: string;
  toDate: string;
  /** Сегодня по времени бизнеса — граница «уже прошло». */
  todayYmd: string;
  /** Работы, на которые уже выставлен живой счёт. Их деньги ждут в
   *  «Документах», и здесь их считать нельзя — иначе одна и та же сотня евро
   *  сидит в двух местах сразу. Набор приходит СВЕРХУ, тот же самый, каким
   *  считает плитка: своя копия правила разъехалась бы на первой же правке. */
  invoicedAppointmentIds: ReadonlySet<string>;
  /** Долги, заведённые руками: «Вася должен мне €100» без визита и «я должен
   *  Gree €900» за товар, взятый до оплаты. Стоят в этом же списке той же
   *  строкой — для человека это один вопрос, кто и сколько должен. */
  debts: readonly Debt[];
  /** Σ платежей по каждому ручному долгу: строка показывает ОСТАТОК. */
  paidTotals: ReadonlyMap<string, number>;
  /** Справочник — вторая строка ручного долга называет, за что он висит. */
  categories: readonly { id: string; name: string }[];
  /** Какую сторону показываем. Владелец 2026-09-10: «там две ступени — я
   *  должен или мне должны, я могу между ними выбирать». */
  direction: DebtDirection;
  onDirectionChange: (next: DebtDirection) => void;
  /** Ручной долг правят в своей шторке: записи за ним нет, открывать нечего. */
  onEditDebt: (debtId: string) => void;
  /** Открыть «Документы» — единственная дорога к деньгам, которые ушли отсюда
   *  под счёт. Без неё пустой экран прячет их молча. Нет обработчика — нет и
   *  двери: на бесплатном тарифе документов в продукте не существует, и
   *  кнопка вела бы в экран, которого нет. */
  onOpenDocuments?: () => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // ПРАВИЛО ДОЛГА — ОДНО НА ПРОДУКТ (`debtRows`). Здесь жила его копия, и с
  // появлением долгов в общей ленте копий стало бы две: список под цифрой
  // обязан сходиться с самой цифрой, а разъезжаются они всегда на правке,
  // которую сделали в одном месте из двух.
  const rows = useMemo(() => {
    // Долг записи бывает ТОЛЬКО входящим: работа сделана, клиент не заплатил.
    // «Я должен» из визита родиться не может — он всегда заводится руками.
    const fromRecords =
      direction === "incoming"
        ? debtRows(appointments, clients, services, {
            from: fromDate,
            to: toDate,
            today: todayYmd,
            teamId: teamId ?? null,
            invoicedAppointmentIds,
          })
        : [];
    const manual = manualDebtRows(
      debts,
      paidTotals,
      { clients, categories },
      { today: todayYmd, direction },
    );
    return mergeDebtRows(fromRecords, manual);
  }, [
    appointments,
    clients,
    services,
    fromDate,
    toDate,
    todayYmd,
    teamId,
    invoicedAppointmentIds,
    debts,
    paidTotals,
    categories,
    direction,
  ]);

  // ПОРЯДОК — КАК В ЛЕНТЕ: свежий день сверху, внутри дня свежий час сверху.
  // Без него дни в секциях выстроились бы в порядке встречи строк.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        const at = a.time ?? "";
        const bt = b.time ?? "";
        if (at !== bt) return at < bt ? 1 : -1;
        return a.key < b.key ? 1 : -1;
      }),
    [rows],
  );

  // Деньги не пропали — они переехали в «Документы». Говорим об этом ТОЛЬКО
  // когда действительно что-то унесли счётом: иначе подсказка про инвойсы
  // висела бы у каждого, кто просто никому ничего не должен.
  const movedToInvoices = useMemo(
    () =>
      invoicedAppointmentIds.size > 0 &&
      appointments.some(
        (a) =>
          invoicedAppointmentIds.has(a.id) &&
          a.date >= fromDate &&
          a.date <= toDate &&
          (!teamId || a.team_id === teamId),
      ),
    [appointments, fromDate, invoicedAppointmentIds, teamId, toDate],
  );

  // Долг закрывается В САМОЙ ЗАПИСИ (канон владельца) — тап ведёт туда тем же
  // адресом с «дорогой назад», каким ленту операций водит openAppointment:
  // календарь встаёт на день и команду записи, закрытие возвращает в финансы.
  const openRow = (r: RecordRow) => {
    // За ручным долгом записи нет — открывать нечего, правят его самого.
    if (r.debtId) {
      onEditDebt(r.debtId);
      return;
    }
    // Команда визита нужна адресу: календарь встаёт на её колонку. Строка
    // приходит из общей панели, поэтому берём её из набора долгов.
    const teamOfRow = sorted.find((x) => x.key === r.key)?.teamId ?? null;
    router.push(
      (`/(dashboard)?appointmentId=${r.appointmentId ?? r.key}&date=${r.date}` +
        (teamOfRow ? `&teamId=${teamOfRow}` : "") +
        // Возврат — в ТОТ ЖЕ разрез: закрыв запись, человек ждёт список
        // должников, а не общую ленту (см. resolveReturnTo).
        "&from=finances:debt") as Href,
    );
  };

  // ДВЕ СТОРОНЫ — ДВА СЛОВА СПРАВА В ЭЙБРАУ (владелец 2026-09-10: «маленькими
  // кнопочками с правой стороны… не надо выделять в кружок, это лишнее; и не
  // надо назначать цветом — можно просто жирность добавить»).
  //
  // Сперва я поставил сюда канонический чип: пилюля с обводкой и цветом
  // стороны (янтарь / красный). Владелец снял и то и другое, и он прав по
  // законам самого продукта: цвет здесь означает НАПРАВЛЕНИЕ ДЕНЕГ, а обе
  // стороны — долги, и красить их разным значило бы обещать, что «я должен» —
  // это расход. Пилюля же весит как действие, а это всего лишь взгляд на тот
  // же список. Остаётся самый тихий признак выбора — вес шрифта.
  const sideButton = (side: DebtDirection) => {
    const active = direction === side;
    return (
      <Pressable
        key={side}
        onPress={() => onDirectionChange(side)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={DEBT_DIRECTION_LABEL[side]}
        hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 13,
            fontWeight: active ? "700" : "500",
            color: active ? t.ink : t.sub,
          }}
        >
          {DEBT_DIRECTION_LABEL[side]}
        </Text>
      </Pressable>
    );
  };

  const sideChips = (
    <>
      {sideButton("incoming")}
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, color: t.separator }}>
        ·
      </Text>
      {sideButton("outgoing")}
    </>
  );

  return (
    <RecordRowsPanel
      // РАЗБИВКА ПО ДНЯМ — КАК У ДОХОДА И РАСХОДА (владелец 2026-09-10: «оно
      // должно разбиваться по времени и дате, как и всё остальное; не „всего
      // столько-то“, а каждый долг — то же самое, что доход и расход»). Панель
      // взята та же: дни с итогом, те же швы, тот же эйбрау. Одно «ВСЕГО»
      // сверху отвечало на вопрос, которого к списку не задают, — а «когда это
      // повисло» пряталось в подписи строки.
      rows={sorted}
      title={panelCount("Долги", sorted.length)}
      tone="debt"
      headerRight={sideChips}
      // Итог дня складывает долги: список однороден, и без этого над каждым
      // днём стоял бы ноль.
      countEveryTone
      emptyTitle={
        direction === "incoming"
          ? "Нет должников за период"
          : "Вы никому не должны за период"
      }
      emptySubtitle={
        movedToInvoices
          ? "Работы, на которые выставлен счёт, ждут оплату в «Документах»"
          : undefined
      }
      emptyAction={
        movedToInvoices && onOpenDocuments
          ? { label: "Открыть документы", onPress: onOpenDocuments }
          : undefined
      }
      refreshControl={refreshControl}
      onOpenRecord={openRow}
    />
  );
}
