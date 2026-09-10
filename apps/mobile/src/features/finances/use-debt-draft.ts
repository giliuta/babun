import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import { debtRemainderCents } from "@babun/shared/local/finance/debt";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { useToast } from "@/components/ui/Toast";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useIsOnline } from "@babun/shared/sync";
import { useFinanceCategories } from "./queries";
import { useClientChoice } from "./use-client-choice";
import { useDeleteDebt, useInsertDebt, useUpdateDebt } from "./debts-queries";

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
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Открытость листов (когда, категория, клиент) — забота вёрстки, не данных.
  const [busy, setBusy] = useState(false);
  /** Отложенное до полного ухода листа: см. `destroy` и уход за клиентом. */
  const afterExit = useRef<(() => void) | null>(null);
  /** Ушли заводить клиента: вернувшись, лист открывается сам и НЕ пересевается
   *  — иначе набранные сумма и заметка пропали бы по дороге. */
  const wentForClient = useRef(false);
  const keepDraft = useRef(false);

  const { clients, statsById, recentIds } = useClientChoice();
  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  const categoriesQuery = useFinanceCategories();
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
    setCategoryId(debt?.category_id ?? null);
    setNote(debt?.note ?? "");
    setBusy(false);
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
  const cats = useMemo(
    () =>
      (categoriesQuery.data ?? []).filter((c) => c.type === "debt" && !c.hidden),
    [categoriesQuery.data],
  );
  const category = cats.find((c) => c.id === categoryId);

  // Остаток по СОХРАНЁННОМУ долгу, а не по тому, что сейчас в поле: платят по
  // тому, что записано, и правка суммы в поле до сохранения не меняет долга.
  const remainder = debt ? debtRemainderCents(debt.amount, paid) / 100 : 0;

  const cents = parseMoneyInputToCents(amount);
  // ИМЯ ХРАНИТСЯ ВСЕГДА, даже когда долг за клиентом: клиента могут удалить, а
  // долг остаётся, и строка обязана продолжать называть человека.
  const who =
    direction === "incoming"
      ? (client?.full_name ?? "").trim()
      : counterparty.trim();
  const named = who.length > 0;
  const canSave = online && !busy && named && cents != null && cents > 0;

  const reason = !online
    ? { text: OFFLINE, error: true }
    : !named
      ? {
          text: direction === "incoming" ? "Выберите клиента" : "Укажите, кто должен",
          error: false,
        }
      : cents == null || cents <= 0
        ? { text: "Введите сумму долга", error: false }
        : null;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = {
        direction,
        counterparty: who,
        amount: (cents as number) / 100,
        // «Я должен» справочником клиентов не пользуется: поставщика в нём нет.
        client_id: direction === "incoming" ? clientId : null,
        occurred_on: date,
        category_id: categoryId,
        note: note.trim() || null,
        team_id: teamId ?? null,
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
    categoryId,
    setCategoryId,
    category,
    cats,
    note,
    setNote,
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
  };
}
