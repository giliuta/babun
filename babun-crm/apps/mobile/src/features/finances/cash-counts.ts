import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpcArgs } from "@babun/shared/db/rpc-args";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { NEVER_PAUSE } from "./accounts";
import { cashCountErrorText } from "./account-alerts";
import {
  COUNT_WINDOW,
  foldCashCounts,
  type CashCount,
  type LastCashCounts,
} from "./cash-counts-window";

// СВЕРКА НАЛИЧНЫХ — ЧТЕНИЕ И ЗАПИСЬ (ТЗ 2026-08-10 §5.5, §3.5, §6).
//
// Пишет только сервер (`record_cash_count`): ожидаемый остаток он снимает САМ,
// под тенантным замком леджера. Клиент своё ожидание не присылает и не может —
// между показом экрана и нажатием кнопки могла пройти оплата. Отсюда закон
// этого модуля: в тост и на экран идёт ТО, ЧТО ВЕРНУЛ СЕРВЕР, а не то, что
// было посчитано на клиенте.
//
// Одна и та же таблица отвечает на два вопроса продукта — «когда эту кассу
// сверяли в последний раз» (подпись строки счёта) и «какие кассы уже сверены
// за сегодня» (закрытие дня). Поэтому запрос ОДИН, а обе поверхности читают
// его по-своему: второй запрос за той же историей рано или поздно дал бы два
// разных ответа про одну кассу.

// Чистая свёртка окна и тристейт lastCountedOn живут в cash-counts-window.ts:
// они закреплены тестом, а этот модуль тянет supabase-клиент и в тест не
// импортируется. Ре-экспорт — чтобы у поверхностей остался один вход.
export {
  lastCountedOn,
  type CashCount,
  type LastCashCounts,
} from "./cash-counts-window";

/** Ряд из базы: и таблица, и RPC отдают одни и те же колонки, поэтому маппер
 *  тоже один — иначе чтение и запись однажды разойдутся в типах денег. */
interface CashCountRow {
  id: string;
  account_id: string;
  business_date: string;
  counted_at: string;
  expected: number;
  counted: number;
  delta: number;
  note: string | null;
  transaction_id: string | null;
}

function toCashCount(row: CashCountRow): CashCount {
  return {
    id: row.id,
    accountId: row.account_id,
    businessDate: row.business_date,
    countedAt: row.counted_at,
    expected: Number(row.expected),
    counted: Number(row.counted),
    delta: Number(row.delta),
    note: row.note,
    transactionId: row.transaction_id,
  };
}

export interface LastCashCountsQuery {
  /** `undefined` — ответа ещё нет (или он не приехал вовсе). */
  last: LastCashCounts | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/** Последняя сверка по каждой кассе. Ключ под `["accounts"]`: сверка меняет и
 *  остаток счёта, и подпись строки, а инвалидация счетов уже стоит на каждой
 *  денежной записи. */
export function useLastCashCounts(): LastCashCountsQuery {
  const tenantId = useTenantId();
  const query = useQuery({
    queryKey: ["accounts", tenantId, "cash-counts"],
    enabled: !!tenantId,
    queryFn: async (): Promise<CashCount[]> => {
      const { data, error } = await supabase
        .from("account_cash_counts")
        .select(
          "id,account_id,business_date,counted_at,expected,counted,delta,note,transaction_id",
        )
        .eq("tenant_id", tenantId as string)
        .order("counted_at", { ascending: false })
        .limit(COUNT_WINDOW);
      if (error) throw new Error(error.message);
      return (data ?? []).map(toCashCount);
    },
  });

  const rows = query.data;
  const last = useMemo<LastCashCounts | undefined>(
    () => (rows ? foldCashCounts(rows) : undefined),
    [rows],
  );

  return {
    last,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface CashCountIntent {
  /** Привязан к НАМЕРЕНИЮ (моменту нажатия): повтор после потерянного ответа
   *  обязан вернуть ту же сверку, а не записать вторую. */
  requestId: string;
  accountId: string;
  counted: number;
  note: string | null;
}

export function useRecordCashCount() {
  const qc = useQueryClient();
  return useMutation({
    // Сверка — запись денег: без сети она обязана честно упасть, а не встать
    // в paused с вечной вертушкой на кнопке (ТЗ §8).
    ...NEVER_PAUSE,
    mutationFn: async (intent: CashCountIntent): Promise<CashCount> => {
      const { data, error } = await supabase.rpc(
        "record_cash_count",
        rpcArgs<"record_cash_count">({
          p_account_id: intent.accountId,
          p_counted: intent.counted,
          p_note: intent.note,
          p_request_id: intent.requestId,
        }),
      );
      if (error) throw new Error(cashCountErrorText(error.message));
      const row = data?.[0];
      if (!row) throw new Error("Сервер не вернул результат пересчёта");
      return toCashCount(row);
    },
    onSuccess: () => {
      // Разница уходит в леджер операцией — обновляются и остатки, и ленты.
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // лист печатает ошибку сам
  });
}
