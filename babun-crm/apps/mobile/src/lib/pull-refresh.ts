import { useCallback, useEffect, useRef, useState } from "react";

// ПОТЯНУЛИ — КРУТИМ. САМИ ОБНОВИЛИСЬ — НЕ ТРОГАЕМ СПИСОК.
//
// `RefreshControl refreshing={isRefetching}` — ловушка, которая была на пяти
// экранах: react-query дообновляет данные при возврате на экран, isRefetching
// становится true, и iOS показывает контрол ПРОГРАММНО — список уезжает вниз
// без всякого жеста, а системная вертушка в этом режиме даже не вращается.
// Владелец 2026-07-27: «оно как будто зависло… такое ощущение, будто тупо
// залагало».
//
// Поэтому контрол отражает РОВНО жест: он крутится, пока не приедут данные
// (промис возвращаем — иначе спиннер гаснет на тёплом кэше раньше ответа), а
// фоновое дообновление показывает LoadingBar, который ничего не сдвигает.

export interface PullRefresh {
  /** В проп `refreshing` контрола — только жест пользователя. */
  refreshing: boolean;
  onRefresh: () => void;
}

export function usePullRefresh(run: () => Promise<unknown>): PullRefresh {
  const [refreshing, setRefreshing] = useState(false);
  // Уйти с экрана во время обновления — обычное дело; тогда состояние снимать
  // уже некуда.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.resolve(run())
      .catch(() => {
        // Ошибку показывает сам экран (его error-состояние); задача хука —
        // погасить спиннер, а не молчать вечно.
      })
      .finally(() => {
        if (alive.current) setRefreshing(false);
      });
  }, [run]);

  return { refreshing, onRefresh };
}
