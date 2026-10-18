import { useEffect, useRef, useState } from "react";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { randomUuid } from "@babun/shared/sync";
import { useBusinessNow } from "@/features/appointments/business-now";
import { categoryInTeam } from "../category-asks";
import {
  operationPatchBaseline,
  type OperationPatchBaseline,
} from "../operation-patch";
import { operationDraftKey, vatDirtyKey } from "../operation-dirty";
import { createOperationRequestIds } from "./request-ids";
import type { OperationDebtPayment, OperationType } from "./types";
import { hydratedAmountText, txVatMode } from "./vat-frame";

/** The operation form's own state: every field the person fills, the
 *  «touched» flags that steer defaults, and the hydration on open. */
export function useOperationDraft({
  visible,
  transaction,
  debtPayment,
  defaultTeamId,
  defaultType,
  defaultDate,
  businessToday,
  canWriteType,
  categories,
  vatRowAllowed,
}: {
  visible: boolean;
  transaction: FinanceTransaction | null | undefined;
  debtPayment: OperationDebtPayment | null | undefined;
  defaultTeamId: string | null | undefined;
  defaultType: OperationType;
  defaultDate: string | null;
  businessToday: string;
  canWriteType: ((type: OperationType) => boolean) | undefined;
  categories: FinanceCategory[];
  /** Строка VAT этому человеку показывается — тогда поле суммы правки
   *  «как назначили цену», иначе валовое (`vat-frame.ts`). */
  vatRowAllowed: boolean;
}) {
  // No free-form «Возврат» here — a real refund is created from the
  // tx-detail popup («Создать возврат»): negative amount + refund_of_id
  // capped by the income's remaining sum (web parity).
  const [type, setType] = useState<OperationType>("expense");
  const typeWritable = (t: OperationType): boolean =>
    canWriteType ? canWriteType(t) : true;
  // Новая операция открывается на стороне, которую человек может завести:
  // «только расходы» не встречает доходом с погашенной кнопкой.
  const otherType = defaultType === "income" ? "expense" : "income";
  const startType =
    !typeWritable(defaultType) && typeWritable(otherType) ? otherType : defaultType;
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(defaultTeamId ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(businessToday);
  // Время операции. Новая —
  // сейчас; у старой строки времени может не быть — тогда его предлагают
  // указать, а не подставляют выдуманное.
  //
  // «СЕЙЧАС» — ПО ЧАСАМ БИЗНЕСА, как и дата (`businessToday`): телефон в
  // другом поясе ставил операции 23:30 по Кипру время 00:30 своего пояса, и
  // строка вставала в конец сегодняшнего списка.
  const businessNow = useBusinessNow();
  const [time, setTime] = useState<string | null>(() => businessNow().hm);
  const [notes, setNotes] = useState("");
  // Документ, подтверждающий операцию (путь в приватном бакете).
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  /** Получатель выплаты — у категории «Зарплата» (`category-asks.ts`). */
  const [masterId, setMasterId] = useState<string | null>(null);
  /** Клиент операции — у категории, которая прикрепляет клиента. */
  const [clientId, setClientId] = useState<string | null>(null);
  /** День и время меняли руками — тогда их потеря тоже «набранное». */
  const [whenTouched, setWhenTouched] = useState(false);
  // Три клавиши НДС на самой операции: НДС указывают не всегда, бывают оплаты без него,
  // и это регулируют самому. Пока не тронули руками, режим следует за настройкой
  // счёта/команды/компании.
  const [vatMode, setVatMode] = useState<TxVatMode>("none");
  const [vatTouched, setVatTouched] = useState(false);
  // Оператор нажал клавишу НДС В ЭТОМ открытии листа. Отдельно от vatTouched:
  // тот при правке взводится гидрацией, а здесь нужен именно жест человека —
  // только он разрешает пересчитать операцию по сегодняшней ставке.
  const [vatRetouched, setVatRetouched] = useState(false);
  // СТРОКА VAT ОТКРЫТА: расход и доход по умолчанию без VAT; кнопочка, которая включает его,
  // спрятана справа у суммы — нажал, и вылазит. Новая операция — без налога и без строки; у
  // старой с налогом строка открыта сразу.
  const [vatShown, setVatShown] = useState(false);
  // «Умный дефолт» счёта: пока диспетчер сам не трогал чипы счёта,
  // счёт следует за командой операции (счета строго per-team).
  const [accountTouched, setAccountTouched] = useState(false);
  // Идемпотентность вставки: клиентский PK по содержимому формы, новый после
  // каждого успеха и при каждом открытии (`request-ids.ts`).
  const requestIds = useRef(createOperationRequestIds(randomUuid)).current;

  // Гидрация ТОЛЬКО по фронту открытия/смене операции: смена businessToday
  // в полночь или фоновый рефетч не должны стирать заполняемую форму.
  const hydratedFor = useRef<string | null>(null);
  /** Снимок формы в момент открытия — по нему решается, есть ли что терять
   *  при закрытии свайпом (`operation-dirty.ts`). */
  const initialDraftKey = useRef<string | null>(null);
  /** Строка операции, КАКОЙ ОНА БЫЛА при открытии формы, — против неё
   *  считается патч правки. Не живой проп: список перечитывается, пока форма
   *  открыта, и снимок «с сервера сейчас» превратил бы чужую свежую правку в
   *  отличие от формы — и форма затёрла бы её старым значением. */
  const patchBaseline = useRef<OperationPatchBaseline | null>(null);
  useEffect(() => {
    if (!visible) {
      hydratedFor.current = null;
      return;
    }
    const key =
      transaction?.id ?? (debtPayment ? `debt:${debtPayment.debtId}` : "new");
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;
    requestIds.done();
    setAccountTouched(false);
    setVatRetouched(false);
    patchBaseline.current = transaction ? operationPatchBaseline(transaction) : null;
    if (transaction) {
      setType(transaction.type === "income" ? "income" : "expense");
      const txVat = txVatMode(transaction);
      const amountText = hydratedAmountText(transaction, vatRowAllowed);
      setVatMode(txVat);
      setVatTouched(true);
      setVatShown(txVat !== "none");
      setAmount(amountText);
      setCategoryId(transaction.category_id ?? null);
      setMasterId(transaction.master_id ?? null);
      setWhenTouched(false);
      setClientId(transaction.client_id ?? null);
      setTeamId(transaction.team_id ?? null);
      setAccountId(transaction.account_id ?? null);
      setDate(transaction.occurred_on);
      setTime(transaction.occurred_time ?? null);
      setNotes(transaction.notes ?? "");
      setReceiptUrl(transaction.receipt_url ?? null);
      initialDraftKey.current = operationDraftKey({
        type: transaction.type === "income" ? "income" : "expense",
        amount: amountText,
        categoryId: transaction.category_id ?? null,
        notes: transaction.notes ?? "",
        receiptUrl: transaction.receipt_url ?? null,
        pickedAccountId: null,
        masterId: transaction.master_id ?? null,
        clientId: transaction.client_id ?? null,
        vat: vatDirtyKey(txVat, Number(transaction.vat_rate ?? 0)),
      });
    } else {
      setType(startType);
      setVatTouched(false);
      setVatMode("none");
      setVatShown(false);
      // Остаток долга подставлен, но не заперт: отдать можно и часть — тогда
      // долг останется висеть на разницу, как и должен.
      setAmount(debtPayment ? String(debtPayment.amount) : "");
      setCategoryId(null);
      setMasterId(null);
      setClientId(null);
      setWhenTouched(false);
      setTeamId(defaultTeamId ?? null);
      setAccountId(null);
      // Разбор дня открывает форму на своём дне; будущее леджер не примет,
      // поэтому дальше сегодняшнего не уходим.
      setDate(defaultDate && defaultDate <= businessToday ? defaultDate : businessToday);
      setTime(businessNow().hm);
      setNotes(debtPayment ? `Долг: ${debtPayment.counterparty}` : "");
      setReceiptUrl(null);
      initialDraftKey.current = operationDraftKey({
        type: defaultType,
        amount: debtPayment ? String(debtPayment.amount) : "",
        categoryId: null,
        notes: debtPayment ? `Долг: ${debtPayment.counterparty}` : "",
        receiptUrl: null,
        pickedAccountId: null,
        masterId: null,
        clientId: null,
      });
    }
    // Hydrate once per opened transaction id (guarded by hydratedFor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visible,
    defaultTeamId,
    defaultType,
    defaultDate,
    transaction?.id,
    businessToday,
    debtPayment,
  ]);

  // КАТЕГОРИЯ — У КОМАНДЫ. Сменили команду операции —
  // выбранная категория переходит на такую же у новой команды или снимается:
  // чужая команда в подписи денег — ошибка, и сервер её не примет. Пока
  // команды нет, выбор не трогаем: старая строка без команды не теряет
  // подписи при открытии.
  useEffect(() => {
    if (!teamId) return;
    setCategoryId((current) => categoryInTeam(categories, current, teamId));
  }, [teamId, categories]);

  return {
    businessNow,
    typeWritable,
    type,
    setType,
    amount,
    setAmount,
    categoryId,
    setCategoryId,
    teamId,
    setTeamId,
    accountId,
    setAccountId,
    date,
    setDate,
    time,
    setTime,
    notes,
    setNotes,
    receiptUrl,
    setReceiptUrl,
    masterId,
    setMasterId,
    clientId,
    setClientId,
    whenTouched,
    setWhenTouched,
    vatMode,
    setVatMode,
    vatTouched,
    setVatTouched,
    vatRetouched,
    setVatRetouched,
    vatShown,
    setVatShown,
    accountTouched,
    setAccountTouched,
    requestIds,
    initialDraftKey,
    patchBaseline,
  };
}

export type OperationDraft = ReturnType<typeof useOperationDraft>;
