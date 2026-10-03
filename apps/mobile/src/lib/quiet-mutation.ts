import { useCallback, useEffect, useRef } from "react";
import {
  MutationObserver,
  useQueryClient,
  type MutateOptions,
  type QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

// МУТАЦИЯ БЕЗ ПОДПИСКИ НА ЕЁ СОСТОЯНИЕ. `useMutation` перерисовывает
// компонент на каждом шаге (idle → pending → success). Большому экрану,
// которому нужно только «сделай», это три лишних прохода рендера на жест.
// Наблюдатель тот же, что внутри `useMutation`; слушатель пустой — он нужен
// лишь затем, чтобы react-query звал `onSuccess`/`onError` конкретного вызова
// (без слушателей он их пропускает).
//
// СВОЙ НАБЛЮДАТЕЛЬ НА КАЖДЫЙ ВЫЗОВ (аудит 2026-10-03). Был один на экран, а
// повторный `observer.mutate` в react-query v5 отвязывает его от прошлой
// мутации: два переноса за время ответа сервера — и отклики ПЕРВОГО
// («Не удалось перенести», «Отменить») не звучали никогда, а общий алерт
// молчит, потому что у мутации есть свой onError. Блок тихо возвращался.

/** Запустить мутацию отдельным наблюдателем: отклики этого вызова живут,
 *  пока он не закончится, сколько бы вызовов ни шло следом. */
export function runDetachedMutation<TData, TError, TVars, TContext>(
  qc: QueryClient,
  options: UseMutationOptions<TData, TError, TVars, TContext>,
  vars: TVars,
  opts?: MutateOptions<TData, TError, TVars, TContext>,
): Promise<void> {
  const observer = new MutationObserver(qc, options);
  const unsubscribe = observer.subscribe(() => {});
  return observer
    .mutate(vars, opts)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(unsubscribe);
}

export function useQuietMutation<TData, TError, TVars, TContext>(
  options: UseMutationOptions<TData, TError, TVars, TContext>,
): { mutate: (vars: TVars, opts?: MutateOptions<TData, TError, TVars, TContext>) => void } {
  const qc = useQueryClient();
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);
  const mutate = useCallback(
    (vars: TVars, opts?: MutateOptions<TData, TError, TVars, TContext>) => {
      void runDetachedMutation(qc, latest.current, vars, opts);
    },
    [qc],
  );
  return { mutate };
}
