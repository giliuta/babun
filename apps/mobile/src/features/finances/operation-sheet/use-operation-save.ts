import { useRef, type MutableRefObject } from "react";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { applyTxVat, type TxVatMode } from "@babun/shared/local/finance/vat";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { isOnline } from "@babun/shared/sync";
import type { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import type { useInsertTransaction, useUpdateTransaction } from "../queries";
import { vatModeForDraft, vatSnapshotForDraft } from "../operation-vat";
import { draftIntentKey, type createRequestIntent } from "../request-intent";
import {
  operationPatchBaseline,
  operationTransactionPatch,
  type OperationPatchBaseline,
} from "../operation-patch";
import { CLOSED_ACCOUNT_REASON, OFFLINE_OPERATION } from "./operation-guards";
import type { OperationDebtPayment, OperationType } from "./types";

/** Everything `save` reads, as of the render that built it. */
export interface OperationSaveInput {
  isEdit: boolean;
  isOwner: boolean;
  transaction: FinanceTransaction | null | undefined;
  debtPayment: OperationDebtPayment | null | undefined;
  fromCalendar: boolean;
  businessToday: string;
  refundedTotal: number;
  type: OperationType;
  amountCents: number | null;
  amountNum: number;
  categoryId: string | null;
  teamId: string | null;
  accountId: string | null;
  payment: PaymentMethod | null;
  masterId: string | null;
  clientId: string | null;
  notes: string;
  date: string;
  time: string | null;
  receiptUrl: string | null;
  askEmployee: boolean;
  attachClient: boolean;
  vatMode: TxVatMode;
  /** Режим, которым поле суммы становится суммой на счёте (`amountVatMode`). */
  amountMode: TxVatMode;
  vatTouched: boolean;
  vatRetouched: boolean;
  vatSettingsKnown: boolean;
  opVatRate: number;
  txAccountClosed: boolean;
  accountMismatch: boolean;
  belowRefunded: boolean;
  lowersWhileRefundsUnknown: boolean;
  requestIntent: ReturnType<typeof createRequestIntent>;
  patchBaseline: MutableRefObject<OperationPatchBaseline | null>;
  insert: ReturnType<typeof useInsertTransaction>;
  update: ReturnType<typeof useUpdateTransaction>;
  toast: ReturnType<typeof useToast>;
  onClose: () => void;
}

/** The form's save: checks in the order the person reads them, then a patch
 *  for an edit or an idempotent insert for a new operation. */
export function useOperationSave(s: OperationSaveInput): () => Promise<void> {
  const savingRef = useRef(false);
  return async () => {
    // Синхронный гард: isPending включается только после ре-рендера,
    // сверхбыстрый двойной тап успевал бы дважды.
    if (savingRef.current) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть.
    if (!isOnline()) {
      notify("Нет сети", OFFLINE_OPERATION);
      return;
    }
    if (s.txAccountClosed) {
      notify("Счёт закрыт", CLOSED_ACCOUNT_REASON);
      return;
    }
    if (s.amountCents == null) {
      notify(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (s.lowersWhileRefundsUnknown) {
      notify(
        "Сверяем возвраты",
        "Возвраты по этому доходу ещё не загрузились — уменьшить сумму можно, когда они придут.",
      );
      return;
    }
    if (s.belowRefunded) {
      notify(
        "Возвращено больше",
        `По этому доходу уже возвращено ${formatEUR(s.refundedTotal)}. Сумма не может стать меньше возвращённого — сначала удалите возврат.`,
      );
      return;
    }
    if (!s.teamId || !s.accountId) {
      notify("Не выбран счёт", "Операции нужны команда и её счёт. Команда выбирается чипом на экране финансов.");
      return;
    }
    if (s.accountMismatch || !s.payment) {
      notify(
        "Счёт не подходит",
        "Сохранённый счёт относится к другой команде или способу оплаты. Выберите доступный счёт заново.",
      );
      return;
    }
    savingRef.current = true;
    try {
      const breakdown = applyTxVat(s.amountNum, s.amountMode, s.opVatRate);
      // РЕЖИМ НДС НАЗЫВАЕМ, ТОЛЬКО ЕСЛИ ЕГО ЗНАЕМ (`operation-vat.ts`): пустая
      // колонка значит «считай сам», а явное 'none' сервер уважает сильнее
      // настроек компании.
      // Новая операция называет серверу ровно то, что на экране: без
      // открытого «+ VAT» — явное «без налога», у кого бы ни
      // была форма. Правка — по прежним правилам (`vatModeForDraft`).
      const vatModeToSend = !s.isEdit
        ? s.vatMode
        : vatModeForDraft({
            mode: s.vatMode,
            chosen: s.vatTouched,
            canReadSettings: s.isOwner,
            settingsKnown: s.vatSettingsKnown,
          });
      const vatSnapshot = vatSnapshotForDraft({
        mode: vatModeToSend,
        rate: s.opVatRate,
        vat: breakdown.vat,
        fresh: !s.isEdit || s.vatRetouched,
      });
      const draft = {
        amount: breakdown.gross,
        ...(vatModeToSend ? { vat_mode: vatModeToSend } : {}),
        category_id: s.categoryId,
        // Получатель — только у зарплаты: сменили категорию — человек не
        // остаётся висеть на «Топливе».
        master_id: s.askEmployee ? s.masterId : null,
        // Клиент — у категории, которая его прикрепляет. У прочих поле не
        // трогаем: клиент оплаты записи или инвойса остаётся на месте.
        ...(s.attachClient ? { client_id: s.clientId } : {}),
        team_id: s.teamId,
        account_id: s.accountId,
        payment_method: s.payment,
        notes: s.notes.trim() || null,
        occurred_on: s.date,
        occurred_time: s.time,
        receipt_url: s.receiptUrl,
        business_today: s.businessToday,
        // Связь с долгом — она и делает операцию его погашением: остаток
        // считается по привязанным платежам, а не колонкой в долге.
        ...(s.debtPayment
          ? { debt_id: s.debtPayment.debtId, client_id: s.debtPayment.clientId }
          : {}),
      };
      if (s.isEdit && s.transaction) {
        // ПАТЧ, А НЕ ОВЕРВРАЙТ: полный черновик
        // перезаписывал поля, которых форма не касалась, — правка заметки на
        // одном устройстве стирала счёт, поменянный секундой раньше на
        // другом. Вычитаем из черновика то, что совпало со снимком, с
        // которым форма открылась (`operation-patch.ts`), и шлём остаток.
        const patch = {
          ...operationTransactionPatch(
            draft,
            s.patchBaseline.current ?? operationPatchBaseline(s.transaction),
          ),
          ...(vatSnapshot ?? {}),
        };
        if (Object.keys(patch).length === 0) {
          // Нечего сохранять — форма открылась и закрылась без правки:
          // сеть здесь не нужна вовсе.
          s.onClose();
          return;
        }
        await s.update.mutateAsync({ id: s.transaction.id, patch, occurredOn: s.date });
      } else {
        const insertDraft = {
          type: s.type,
          ...(s.fromCalendar ? { from_calendar: true } : {}),
          ...draft,
          ...(vatSnapshot ?? {}),
        };
        // request_id стабилен, пока черновик тот же: ретрай после потерянного
        // ответа не задваивает деньги (duplicate key = успех в репозитории), а
        // правка любого поля перед ретраем — уже другая операция с новым id.
        // «Сегодня бизнеса» — подсказка проверке, а не поле операции: смена
        // суток между попытками не делает её другой.
        const requestId = s.requestIntent.idFor(
          draftIntentKey({ ...insertDraft, business_today: undefined }),
        );
        await s.insert.mutateAsync({ request_id: requestId, ...insertDraft });
        s.requestIntent.done();
      }
      haptics.success();
      s.toast(s.isEdit ? "Сохранено" : "Операция добавлена");
      s.onClose();
    } catch (e) {
      notify("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
    }
  };
}
