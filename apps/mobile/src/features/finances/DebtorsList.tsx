import { useMemo, type ReactElement } from "react";
import { ScrollView, View, type RefreshControlProps } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import { DEBT_DIRECTION_LABEL } from "@babun/shared/local/finance/debt";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { PanelHeader } from "./PanelHeader";
import { RecordRowView } from "./RecordRow";
import { debtRows, manualDebtRows, mergeDebtRows } from "./debt-rows";

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
   *  под счёт. Без неё пустой экран прячет их молча. */
  onOpenDocuments: () => void;
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

  // Итог стороны. Число здесь важнее счётчика строк: «сколько всего висит» —
  // первый вопрос к этому списку, а «сколько строк» не спрашивают никогда.
  const total = useMemo(
    () => rows.reduce((sum, r) => sum + r.amount, 0),
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
  const openRow = (r: (typeof rows)[number]) => {
    // За ручным долгом записи нет — открывать нечего, правят его самого.
    if (r.debtId) {
      onEditDebt(r.debtId);
      return;
    }
    router.push(
      (`/(dashboard)?appointmentId=${r.key}&date=${r.date}` +
        (r.teamId ? `&teamId=${r.teamId}` : "") +
        // Возврат — в ТОТ ЖЕ разрез: закрыв запись, человек ждёт список
        // должников, а не общую ленту (см. resolveReturnTo).
        "&from=finances:debt") as Href,
    );
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={refreshControl}
    >
      {/* Эйбрау — тот же, что у ленты операций: панель обязана называть себя,
          иначе список должников читается как продолжение сводки. Тело
          начинается сразу под ним — воздух между именем панели и её строками
          один на все шесть. */}
      {/* ДВЕ СТОРОНЫ ОДНОГО ВОПРОСА (владелец 2026-09-10). Складывать их в
          одно число нельзя: одни деньги придут, другие уйдут, и сумма «€957»
          не значила бы ничего. Поэтому переключатель, а не общий столбик. */}
      <SegmentedControl
        options={[
          {
            value: "incoming" as DebtDirection,
            label: DEBT_DIRECTION_LABEL.incoming,
            color: t.warning,
          },
          {
            value: "outgoing" as DebtDirection,
            label: DEBT_DIRECTION_LABEL.outgoing,
            color: t.danger,
          },
        ]}
        value={direction}
        onChange={onDirectionChange}
        style={{ marginHorizontal: GUTTER, marginTop: 4 }}
      />
      {/* Сумма ИМЕННО ЭТОЙ стороны. Плитка «Долги» над списком считает деньги,
          которые придут, и рядом с открытой стороной «Я должен» её €252
          читались как «я должен €252». Итог под переключателем снимает
          вопрос — в том числе нулём. */}
      <PanelHeader title={`Всего · ${formatEUR(total)}`} />
      {rows.length === 0 ? (
        // Пустое состояние — общее на все панели экрана: своя тихая строчка
        // внутри карточки выглядела как «карточка сломалась».
        <EmptyState
          title={
            direction === "incoming"
              ? "Нет должников за период"
              : "Вы никому не должны за период"
          }
          subtitle={
            movedToInvoices
              ? "Работы, на которые выставлен счёт, ждут оплату в «Документах»"
              : undefined
          }
          action={
            movedToInvoices
              ? { label: "Открыть документы", onPress: onOpenDocuments }
              : undefined
          }
        />
      ) : (
        <Card style={{ marginHorizontal: GUTTER }}>
          {/* ТА ЖЕ СТРОКА, ЧТО В ДОХОДЕ И РАСХОДЕ (владелец 2026-09-09):
              клиент, услуги, сумма — и «когда и как давно» вместо часа
              визита. Час приезда бригады на решение «звонить или нет» не
              влияет, возраст долга влияет.

              КРИЧАЩЕЙ ПОДПИСИ «НЕ ЗАКРЫТЫ» БОЛЬШЕ НЕТ (владелец 2026-09-09:
              «зачем ты пишешь „не закрыто“, это лишнее»). Она называла
              состояние ЗАПИСИ словами продукта и не подсказывала действия.
              Порядок остался: сначала подтверждённые долги, ниже — визиты,
              по которым бригада не отчиталась. */}
          {[...rows]
            .sort((a, b) => Number(a.unclosed) - Number(b.unclosed))
            .map((r, i) => (
              <View
                key={r.key}
                style={
                  i > 0
                    ? { borderTopWidth: 1, borderTopColor: t.separator }
                    : undefined
                }
              >
                <RecordRowView
                  row={r}
                  tone="debt"
                  onPress={() => openRow(r)}
                />
              </View>
            ))}
        </Card>
      )}
    </ScrollView>
  );
}
