import { useCallback, useEffect, useState } from "react";
import {
  MutationObserver,
  useQueryClient,
  type MutateOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

// МУТАЦИЯ БЕЗ ПОДПИСКИ НА ЕЁ СОСТОЯНИЕ. `useMutation` перерисовывает
// компонент на каждом шаге (idle → pending → success). Большому экрану,
// которому нужно только «сделай», это три лишних прохода рендера на жест.
// Наблюдатель тот же, что внутри `useMutation`; слушатель пустой — он нужен
// лишь затем, чтобы react-query звал `onSuccess`/`onError` конкретного вызова
// (без слушателей он их пропускает).

export function useQuietMutation<TData, TError, TVars, TContext>(
  options: UseMutationOptions<TData, TError, TVars, TContext>,
): { mutate: (vars: TVars, opts?: MutateOptions<TData, TError, TVars, TContext>) => void } {
  const qc = useQueryClient();
  const [observer] = useState(() => new MutationObserver(qc, options));
  useEffect(() => {
    observer.setOptions(options);
  }, [observer, options]);
  useEffect(() => observer.subscribe(() => {}), [observer]);
  const mutate = useCallback(
    (vars: TVars, opts?: MutateOptions<TData, TError, TVars, TContext>) => {
      observer.mutate(vars, opts).catch(() => {});
    },
    [observer],
  );
  return { mutate };
}
