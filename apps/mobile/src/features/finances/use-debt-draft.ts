import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import { debtRemainderCents } from "@babun/shared/local/finance/debt";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { useToast } from "@/components/ui/Toast";
import { formatHM } from "@/features/appointments/helpers";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import { confirmAction, confirmThen } from "@/lib/confirm";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useIsOnline } from "@babun/shared/sync";
import { useFinanceCategories } from "./queries";
import { categoryInTeam, pickableCategories } from "./category-asks";
import { useTeams } from "@/features/reference/queries";
import { useClientChoice } from "./use-client-choice";
import { useDeleteDebt, useInsertDebt, useUpdateDebt } from "./debts-queries";
import { useReceiptSession } from "./receipt-upload";

// ЧЕРНОВИК ДОЛГА — ДАННЫЕ ФОРМЫ ОТДЕЛЬНО ОТ ЕЁ ВЁРСТКИ (тот же приём, что у
// карточки клиента, `useClientDraft`). Поля, пересев, проверки, запись,
// удаление и поход за новым клиентом — здесь; в листе остаются одни блоки.

const OFFLINE = "Долг записывается только онлайн: нет сети";

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function useDebtDraft({
  visible,
  debt,
  initialDirection,
  teamId,
  paid,
  onClose,
  onReopen,
}: {
  visible: boolean;
  debt?: Debt | null;
  initialDirection: DebtDirection;
  teamId?: string | null;
  paid: number;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const isEdit = !!debt;

  const [direction, setDirection] = useState<DebtDirection>(initialDirection);
  const [counterparty, setCounterparty] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  // ЧАС — КАК У ОПЕРАЦИИ (владелец 2026-09-10: «время должно быть такое же,
  // как в доходе»). У нового долга это «сейчас»; у заведённого до появления
  // колонки часа нет, и подставлять выдуманный нельзя.
  const [time, setTime] = useState<string | null>(() => formatHM(new Date()));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // КОМАНДА ДОЛГА (владелец 2026-09-24: «всё отдельно под каждую команду»;
  // долг без команды сервер не примет). Своя у долга, а не «выбранная сейчас
  // на странице»: правка долга из общего вида раньше слала `team_id: null` и
  // снимала с долга команду.
  const [pickedTeamId, setPickedTeamId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Документ под долгом — тот же приватный бакет чеков, что у операции.
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Открытость листов (когда, категория, клиент) — забота вёрстки, не данных.
  const [busy, setBusy] = useState(false);
  /** Отложенное до полного ухода листа: см. `destroy` и уход за клиентом. */
  const afterExit = useRef<(() => void) | null>(null);
  /** Ушли заводить клиента: вернувшись, лист открывается сам и НЕ пересевается
   *  — иначе набранные сумма и заметка пропали бы по дороге. */
  const wentForClient = useRef(false);
  // Файлы, залитые в этом долге: чистим, когда лист закрыт насовсем — но не
  // когда он уехал за новым клиентом и вернётся с тем же черновиком.
  const receiptSession = useReceiptSession();
  useEffect(() => {
    if (!visible && !wentForClient.current) receiptSession.flush();
  }, [visible, receiptSession]);
  const keepDraft = useRef(false);
  /** Снимок черновика при открытии: по нему решается, спросить ли перед
   *  закрытием свайпом (прогон финансов 2026-09-24 — €44 пропали молча). */
  const initialKey = useRef<string | null>(null);
  const [askingClose, setAskingClose] = useState(false);

  const { clients, statsById, recentIds } = useClientChoice();
  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  const categoriesQuery = useFinanceCategories();
  const teams = useTeams().data ?? [];
  // Одна команда — вопроса нет, она и есть команда долга.
  const debtTeamId = pickedTeamId ?? (teams.length === 1 ? teams[0].id : null);
  const insert = useInsertDebt();
  const update = useUpdateDebt();
  const remove = useDeleteDebt();

  // Шторка остаётся смонтированной между открытиями: без пересева она
  // показала бы прошлый долг поверх нового (закон формы операции).
  useEffect(() => {
    if (!visible) return;
    if (keepDraft.current) {
      keepDraft.current = false;
      return;
    }
    setDirection(debt?.direction ?? initialDirection);
    setCounterparty(debt?.counterparty ?? "");
    setClientId(debt?.client_id ?? null);
    setAmount(debt ? String(debt.amount) : "");
    setDate(debt?.occurred_on ?? todayYmd());
    setTime(debt ? debt.occurred_time : formatHM(new Date()));
    setCategoryId(debt?.category_id ?? null);
    setPickedTeamId(debt?.team_id ?? teamId ?? null);
    setNote(debt?.note ?? "");
    setReceiptUrl(debt?.receipt_url ?? null);
    setBusy(false);
    initialKey.current = draftKey({
      direction: debt?.direction ?? initialDirection,
      counterparty: debt?.counterparty ?? "",
      clientId: debt?.client_id ?? null,
      amount: debt ? String(debt.amount) : "",
      categoryId: debt?.category_id ?? null,
      note: debt?.note ?? "",
      receiptUrl: debt?.receipt_url ?? null,
    });
    // Команду страницы берём только при открытии — смена чипа под шторкой не
    // должна перекидывать набранный долг.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, debt, initialDirection]);

  // ВОЗВРАЩЕНИЕ ИЗ КАРТОЧКИ НОВОГО КЛИЕНТА. Карточка кладёт id в ящик и уходит
  // «назад» (см. `pending-client.ts`); мы забираем его, получив фокус, и
  // открываемся заново — с прежним черновиком и выбранным клиентом.
  //
  // Ящик читаем ТОЛЬКО если уходили сами: чужую доставку (из формы записи)
  // брать нельзя. И возвращаемся ДАЖЕ БЕЗ клиента — человек мог передумать и
  // нажать «назад», а набранная сумма не должна пропасть вместе с листом.
  useFocusEffect(
    useCallback(() => {
      if (!wentForClient.current) return;
      wentForClient.current = false;
      keepDraft.current = true;
      const id = takeCreatedClient();
      if (id) setClientId(id);
      onReopen?.();
    }, [onReopen]),
  );

  // Категории долгов НЕ смешиваются с доходными и расходными (владелец
  // 2026-09-10): в списке поставщиков и займов «Бензину» делать нечего.
  // И они у команды долга (владелец 2026-09-24): чужих команд в выборе нет.
  const cats = useMemo(
    () => pickableCategories(categoriesQuery.data ?? [], "debt", categoryId, debtTeamId),
    [categoriesQuery.data, categoryId, debtTeamId],
  );
  // Сменили команду — категория переходит на такую же у новой или снимается.
  useEffect(() => {
    if (!debtTeamId) return;
    setCategoryId((current) => categoryInTeam(categoriesQuery.data ?? [], current, debtTeamId));
  }, [debtTeamId, categoriesQuery.data]);
  const category = cats.find((c) => c.id === categoryId);

  // Остаток по СОХРАНЁННОМУ долгу, а не по тому, что сейчас в поле: платят по
  // тому, что записано, и правка суммы в поле до сохранения не меняет долга.
  const remainder = debt ? debtRemainderCents(debt.amount, paid) / 100 : 0;

  const cents = parseMoneyInputToCents(amount);
  // ИМЯ ХРАНИТСЯ ВСЕГДА, даже когда долг за клиентом: клиента могут удалить, а
  // долг остаётся, и строка обязана продолжать называть человека. Поэтому имя
  // из карточки СНИМАЕТСЯ в долг, а не читается из неё каждый раз.
  const who = (client?.full_name || counterparty).trim();
  const named = who.length > 0;
  const canSave =
    online && !busy && !!debtTeamId && named && cents != null && cents > 0;

  const reason = !online
    ? { text: OFFLINE, error: true }
    : !debtTeamId
      ? { text: "Выберите команду", error: false }
      : !named
        ? { text: "Выберите клиента", error: false }
        : cents == null || cents <= 0
          ? { text: "Введите сумму долга", error: false }
          : null;

  // Синхронный засов: `busy` включается только к следующему кадру, и
  // двойной тап успевал записать два одинаковых долга (аудит 2026-09-24) —
  // тот же приём, что `savingRef` формы операции.
  const savingRef = useRef(false);
  const save = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const payload = {
        direction,
        counterparty: who,
        amount: (cents as number) / 100,
        client_id: clientId,
        occurred_on: date,
        occurred_time: time,
        category_id: categoryId,
        note: note.trim() || null,
        receipt_url: receiptUrl,
        team_id: debtTeamId,
        business_today: todayYmd(),
      };
      if (isEdit && debt) {
        await update.mutateAsync({ id: debt.id, patch: payload });
      } else {
        await insert.mutateAsync(payload);
      }
      haptics.success();
      toast(isEdit ? "Долг сохранён" : "Долг записан");
      onClose();
    } catch (e) {
      notify("Не удалось сохранить", (e as Error).message);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  // УДАЛЕНИЕ ДОЛГА НЕ ТРОГАЕТ ДЕНЬГИ. Платежи по нему остаются на счёте и в
  // прибыли — они случились; связь просто снимается. Об этом и предупреждаем:
  // «удалить долг» человек читает как «стереть всё, что с ним связано».
  //
  // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29): вопрос рисует
  // хост приложения, а лист — отдельное окно `Modal`, и открытый в тот же кадр
  // вопрос получает от iOS «already presenting». Кнопка молчала — проверено на
  // симуляторе 2026-09-10, ровно как это уже было у «Удалить операцию».
  // Сперва уезжаем, спрашиваем по `onExited`.
  const destroy = () => {
    if (!debt) return;
    const target = debt;
    afterExit.current = () => {
      confirmThen(
        "Удалить долг?",
        {
          message:
            "Платежи по нему останутся в журнале и на счёте — они уже случились. Пропадёт только сам долг.",
          confirmLabel: "Удалить",
          destructive: true,
        },
        async () => {
          try {
            await remove.mutateAsync(target.id);
            haptics.success();
            toast("Долг удалён");
          } catch (e) {
            notify("Не удалось удалить", (e as Error).message);
          }
        },
      );
    };
    onClose();
  };

  const leaveForClient = (prefill: { name?: string; phone?: string }) => {
    wentForClient.current = true;
    afterExit.current = () =>
      router.push({ pathname: "/client", params: { id: "new", ...prefill } });
    onClose();
  };

  // НАБРАННОЕ НЕ ТЕРЯЕТСЯ МОЛЧА — тот же закон, что у формы операции
  // (`operation-dirty.ts`): есть что терять — лист уезжает и спрашивает;
  // «Отмена» возвращает его со всем набранным.
  const dirty =
    initialKey.current !== null
    && draftKey({ direction, counterparty, clientId, amount, categoryId, note, receiptUrl })
      !== initialKey.current;
  /** Закрыть — или уйти к оплате долга: набранное в долге не пропадает молча
   *  ни тем, ни другим путём (аудит 2026-09-24). */
  const guardedClose = (leave?: () => void) => {
    if (busy) return;
    if (!dirty) {
      (leave ?? onClose)();
      return;
    }
    afterExit.current = () => {
      void confirmAction("Закрыть без сохранения?", {
        message: "Набранное в долге не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      }).then((ok) => {
        if (ok) {
          setAskingClose(false);
          (leave ?? onClose)();
          return;
        }
        setTimeout(() => setAskingClose(false), SHEET_EXIT_MS + 350);
      });
    };
    setAskingClose(true);
  };

  const runAfterExit = () => {
    const run = afterExit.current;
    afterExit.current = null;
    run?.();
  };


  return {
    isEdit,
    direction,
    setDirection,
    counterparty,
    setCounterparty,
    clientId,
    setClientId,
    client,
    amount,
    setAmount,
    date,
    setDate,
    time,
    setTime,
    categoryId,
    setCategoryId,
    category,
    cats,
    teams,
    debtTeamId,
    setDebtTeamId: setPickedTeamId,
    note,
    setNote,
    receiptUrl,
    setReceiptUrl,
    receiptSession,
    busy,
    clients,
    statsById,
    recentIds,
    remainder,
    canSave,
    reason,
    save,
    destroy,
    /** Уйти за новым клиентом: лист обязан сперва закрыть СВОЁ окно, иначе
     *  маршрут карточки под ним не виден. */
    leaveForClient,
    /** Что отложено до полного ухода листа — зовётся из `onExited`. */
    runAfterExit,
    /** Закрытие свайпом/скримом с вопросом, если есть что терять. */
    guardedClose,
    /** Лист уехал на время вопроса: `visible && !askingClose`. */
    askingClose,
  };
}

/** Снимок полей, которые человек набирает руками (дата и время — подстановки
 *  формы, в снимок не входят). Пробелы по краям не считаются вводом. */
function draftKey(f: {
  direction: string;
  counterparty: string;
  clientId: string | null;
  amount: string;
  categoryId: string | null;
  note: string;
  receiptUrl: string | null;
}): string {
  return JSON.stringify([
    f.direction,
    f.counterparty.trim(),
    f.clientId,
    f.amount.trim(),
    f.categoryId,
    f.note.trim(),
    f.receiptUrl,
  ]);
}
