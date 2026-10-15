import { useEffect, useRef } from "react";
import type { GateRef } from "./reference-gate";

/** The optional reference that failed to load (banner), retried while open. */
export function useReferenceRetry(
  referenceQueries: readonly GateRef[],
  essentialQueries: readonly GateRef[],
) {
  const failedOptional = referenceQueries.find(
    ({ query }) =>
      query.isLoadingError && !essentialQueries.some((e) => e.query === query),
  );
  // УПАВШИЙ СПРАВОЧНИК ПЕРЕЧИТЫВАЕТСЯ, ПОКА ФОРМА ОТКРЫТА (после
  // лежащего сервера). Сервер вернулся, а «Не удалось загрузить партнёров»
  // висела над формой до её закрытия: сам запрос больше никто не будил —
  // сеть телефона не пропадала, и react-query «переподключения» не видел.
  // Так же, как счета оплаты (`useTeamPaymentAccounts`), — раз в 10 с.
  const referenceQueriesRef = useRef(referenceQueries);
  referenceQueriesRef.current = referenceQueries;
  const failedOptionalLabel = failedOptional?.label ?? null;
  useEffect(() => {
    if (!failedOptionalLabel) return;
    const timer = setInterval(() => {
      for (const { query } of referenceQueriesRef.current) {
        if (query.isLoadingError && !query.isFetching) void query.refetch();
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [failedOptionalLabel]);
  return failedOptional;
}
