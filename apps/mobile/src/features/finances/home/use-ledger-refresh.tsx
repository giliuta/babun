import { useCallback, useRef } from "react";
import { RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";

/** Both refresh doors of the tab — return to the tab and pull-to-refresh —
 *  plus the one RefreshControl every panel hands to its scroll. */
export function useLedgerRefresh() {
  const t = useThemeColors();
  // Возврат на таб — повод довезти чужие правки: реалтайм-мост финансовые
  // таблицы не покрывает, а экран таба живёт смонтированным весь сеанс —
  // без этого владелец, вернувшийся из календаря через час, читал утренние
  // остатки. invalidate (тот же набор, что у invalidateLedger), а не полный
  // refetch: обновляются только активные подписки, данные стоят на своём
  // ключе и не мигают. Первый фокус пропускаем — маунт и так всё грузит.
  //
  // ОДИН НАБОР КЛЮЧЕЙ НА ОБЕ ДВЕРИ ОБНОВЛЕНИЯ: возврат по фокусу и жест
  // pull-to-refresh (U86) обязаны довозить одно и то же — две копии списка
  // разъехались бы на первой правке.
  //
  // ["debts"] — с 2026-09-15 обязательно. Раньше тап по команде менял ключ
  // долгов, и устаревший ключ перечитывался сам; теперь ключ один на компанию,
  // тап сети не трогает, и эти две двери — единственный путь, которым долги,
  // заведённые с другого устройства, доезжают до экрана.
  const qc = useQueryClient();
  const invalidateLedger = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["debts"] }),
        qc.invalidateQueries({ queryKey: ["accounts"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        // Чеки держат плитку «Документы» — без них она жила старым числом.
        qc.invalidateQueries({ queryKey: ["receipts"] }),
      ]),
    [qc],
  );
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void invalidateLedger();
    }, [invalidateLedger]),
  );
  // Жест «потянуть вниз» — один RefreshControl на все панели экрана: лента,
  // счета, документы и долги передают его своему скроллу. Крутится, пока
  // активные запросы не доедут (invalidateQueries возвращает этот промис).
  // Потянули вниз — перечитать и записи: материалы и долги записей стоят в
  // «Расходе», «Прибыли» и «Долгах», а жили только на realtime. На фокусе
  // записи не трогаем — это полный список календаря.
  const pullRefresh = useCallback(
    () =>
      Promise.all([
        invalidateLedger(),
        qc.invalidateQueries({ queryKey: ["appointments"] }),
      ]),
    [invalidateLedger, qc],
  );
  const pull = usePullRefresh(pullRefresh);
  return (
    <RefreshControl
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      tintColor={t.accent}
    />
  );
}
