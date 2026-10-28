import { useRef, useState, type ReactElement } from "react";
import type { Href, useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { Trash2 } from "lucide-react-native";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { humanDay } from "@/features/appointments/helpers";
import type { useSetDayExtras } from "@/features/calendar/queries";
import { useDeleteTransaction, useRefundTotals } from "@/features/finances/queries";
import { deleteOperationAlert } from "@/features/finances/account-alerts";
import { deletableByHand, refundDeleteNotice } from "@/features/finances/operation-delete";
import { confirmThen } from "@/lib/confirm";
import { writeErrorWords } from "@/lib/connection-words";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { canEditDayMoneyRow } from "@/features/calendar/day-money-access";
import type { useMyAccess } from "@/session/access-queries";
import type { useCurrentRole } from "@/session/tenant";

/** What a row of the sheet opens, asks or swipes away — always after the
 *  sheet has left (see `leaveThen`). */
export function useDayFinanceActions({
  onClose,
  onEditAppointment,
  findRecord,
  router,
  teamId,
  shownYmd,
  ymd,
  legacyExtras,
  setExtras,
  apptById,
  recordOf,
  servicesOf,
  nameById,
  categoryName,
  role,
  myAccess,
  me,
}: {
  onClose: () => void;
  onEditAppointment?: (a: Appointment) => void;
  findRecord?: (id: string) => Appointment | undefined;
  router: ReturnType<typeof useRouter>;
  teamId: string | null;
  shownYmd: string | null;
  ymd: string;
  legacyExtras: DayExtra[];
  setExtras: ReturnType<typeof useSetDayExtras>;
  apptById: Map<string, Appointment>;
  recordOf: (tx: FinanceTransaction) => Appointment | undefined;
  servicesOf: (a: Appointment) => string;
  nameById: Map<string, string>;
  categoryName: Map<string, string>;
  role: ReturnType<typeof useCurrentRole>["data"];
  myAccess: ReturnType<typeof useMyAccess>["data"];
  me: string | null;
}) {
  const t = useThemeColors();
  // ФОРМА ОПЕРАЦИИ И ЗАПИСЬ — ПОСЛЕ УХОДА ЛИСТА: второй системный Modal
  // поверх уходящего iOS молча не показывает (тот же закон, что у попапа
  // финансов). Пока лист уходит, тапы не принимаются — второй тап затирал бы
  // отложенное действие.
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [opType, setOpType] = useState<"income" | "expense">("expense");
  const afterExit = useRef<(() => void) | null>(null);
  const leaveThen = (run: () => void) => {
    afterExit.current = run;
    onClose();
  };
  const openOperation = (tx: FinanceTransaction | null, type: "income" | "expense") => {
    setEditingTx(tx);
    setOpType(type);
    leaveThen(() => setOpOpen(true));
  };
  const openRecord = (appointmentId: string) => {
    const known = apptById.get(appointmentId) ?? findRecord?.(appointmentId);
    leaveThen(() => {
      if (known && onEditAppointment) onEditAppointment(known);
      else router.push(`/book?appointmentId=${appointmentId}` as Href);
    });
  };
  const askRemoveLegacy = (e: DayExtra) => {
    if (!teamId || !shownYmd) return;
    haptics.tap();
    const day = shownYmd;
    const rest = legacyExtras.filter((x) => x.id !== e.id);
    leaveThen(() =>
      confirmThen(
        "Удалить операцию?",
        {
          message: `«${e.name}» исчезнет из финансов этого дня.`,
          confirmLabel: "Удалить",
          destructive: true,
        },
        () => setExtras.mutate({ teamId, dateKey: day, extras: rest }),
      ),
    );
  };

  // Заголовок и контекст строки — той же грамматикой, что лента «Финансов»:
  // доход по записи называется её услугами, расход — категорией.
  const rowTitle = (tx: FinanceTransaction): string => {
    const appt = recordOf(tx);
    const names = appt ? servicesOf(appt) : "";
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    if (tx.type === "income" || tx.type === "refund") {
      return names || tx.notes || cat || (tx.type === "refund" ? "Возврат" : "Поступление");
    }
    return cat || tx.notes || "Расход";
  };
  const rowContext = (tx: FinanceTransaction): string => {
    const appt = recordOf(tx);
    // Оплата записи ДРУГОГО дня (предоплата за завтра): время — её, а не
    // записи, и день записи словами — иначе строка выглядит визитом сегодня.
    const foreign = appt && appt.date !== ymd ? appt : null;
    const time = (foreign ? null : appt?.time_start) || tx.occurred_time || "";
    if (tx.type === "income" || tx.type === "refund") {
      const who = tx.client_id ? nameById.get(tx.client_id) ?? "" : "";
      const forDay = foreign
        ? `${tx.appointment_payment_kind === "prepayment" ? "предоплата" : "оплата"} за ${humanDay(foreign.date).replace(/^\S+ /, "")}`
        : "";
      return [time, who, forDay].filter(Boolean).join(" · ");
    }
    const cat = tx.category_id ? categoryName.get(tx.category_id) : null;
    return [time, cat && tx.notes ? tx.notes : ""].filter(Boolean).join(" · ");
  };
  const rowAction = (tx: FinanceTransaction): (() => void) | undefined => {
    if (tx.appointment_id) {
      const id = tx.appointment_id;
      return () => openRecord(id);
    }
    // Партнёр с «Вносит» правит СВОЮ операцию из календаря, владелец —
    // любую; оплату долга ведёт экран долгов. Сервер отказывает ровно так же
    // (`finance_transactions_update_day_money`) — двери, которая кончится
    // отказом, нет (правило 10).
    const side = tx.type === "expense" ? "expense" : "income";
    if (
      canEditTransaction(tx) &&
      (role === "owner" || !tx.debt_id) &&
      canEditDayMoneyRow({
        role,
        map: myAccess,
        teamId: tx.team_id ?? teamId,
        createdBy: tx.created_by,
        me,
        fromCalendar: tx.from_calendar,
      })
    ) {
      return () => openOperation(tx, side);
    }
    return undefined;
  };

  // СВАЙП «УДАЛИТЬ» — У РУЧНЫХ ОПЕРАЦИЙ, КОТОРЫЕ ЭТОМУ ЧЕЛОВЕКУ МОЖНО ПРАВИТЬ
  // (кнопки «Удалить операцию» в листе нет). Те же
  // правила, что в ленте «Финансов» (`operation-delete.ts`); деньги записи
  // снимаются в самой записи. Вопрос — после ухода листа, как у старых строк.
  const delTx = useDeleteTransaction();
  const refundTotals = useRefundTotals().data;
  const canDeleteTx = (tx: FinanceTransaction): boolean =>
    !tx.appointment_id &&
    tx.type !== "transfer" &&
    deletableByHand(tx) &&
    rowAction(tx) !== undefined;
  const askDeleteTx = (tx: FinanceTransaction) => {
    const blocked = refundDeleteNotice(tx, refundTotals ? (refundTotals.get(tx.id) ?? 0) : undefined);
    if (blocked) {
      haptics.warning();
      notify(blocked.title, blocked.message);
      return;
    }
    const text = deleteOperationAlert();
    leaveThen(() =>
      confirmThen(
        text.title,
        { message: text.message, confirmLabel: text.confirm, destructive: true },
        async () => {
          try {
            await delTx.mutateAsync(tx.id);
            haptics.success();
          } catch (e) {
            const words = writeErrorWords(e, {
              failed: "Не удалось удалить",
              notDone: "Операция не удалена",
            });
            notify(words.title, words.subtitle);
          }
        },
      ),
    );
  };
  const swipeTx = (key: string, tx: FinanceTransaction, row: ReactElement) =>
    canDeleteTx(tx) ? (
      <SwipeRow
        key={key}
        radius={t.radius.input}
        label="Удалить"
        color={t.danger}
        icon={Trash2}
        accessibilityLabel={`Удалить «${rowTitle(tx)}»`}
        onAction={() => askDeleteTx(tx)}
      >
        {row}
      </SwipeRow>
    ) : (
      row
    );

  return {
    opOpen,
    setOpOpen,
    editingTx,
    opType,
    afterExit,
    openOperation,
    openRecord,
    askRemoveLegacy,
    rowTitle,
    rowContext,
    rowAction,
    swipeTx,
  };
}
