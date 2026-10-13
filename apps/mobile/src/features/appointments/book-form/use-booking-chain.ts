import { useEffect, type Dispatch, type SetStateAction } from "react";
import { CHAIN_START_MS } from "./book-constants";
import type { ChainStep } from "./use-record-picks";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface BookingChainInput {
  chainStep: ChainStep;
  setChainStep: Setter<ChainStep>;
  isEdit: boolean;
  kind: "work" | "event";
  referencesPending: boolean;
  clientId: string | null;
  setClientPickerOpen: Setter<boolean>;
  servicesPending: boolean;
  serviceIdsCount: number;
  teamServicesCount: number;
  setServicePickerOpen: Setter<boolean>;
}

/** The «slot → client → services» chain of a fresh record (see `pickClient`). */
export function useBookingChain({
  chainStep,
  setChainStep,
  isEdit,
  kind,
  referencesPending,
  clientId,
  setClientPickerOpen,
  servicesPending,
  serviceIdsCount,
  teamServicesCount,
  setServicePickerOpen,
}: BookingChainInput) {
  useEffect(() => {
    if (chainStep !== "idle") return;
    if (isEdit || kind !== "work") return;
    // Ждём, пока справочники доедут: лист поверх скелета показал бы пустоту.
    if (referencesPending) return;
    // ЖДЁМ, ПОКА УЕДЕТ ПОПАП СЛОТА, А НЕ ОТКРЫВАЕМ СРАЗУ.
    //
    // Цепочку начинает попап слота на КАЛЕНДАРЕ — он тоже `Modal`. Пока он
    // закрывается, форма уже смонтирована и просит показать свой лист; окно,
    // поданное поверх ещё закрывающегося, на iOS не появляется вовсе и об
    // этом не сообщает. Это записанный закон продукта (SHEET_EXIT_MS,
    // MODAL_EXIT_MS) — и я всё равно на него наступил: эффект отрабатывал,
    // `visible` становился true, а на экране не было ничего.
    //
    // `InteractionManager` здесь НЕ ПОМОГАЕТ, и это стоит помнить: он ждёт
    // взаимодействий и анимаций React Native, а уход модалки — анимация
    // UIKit, о которой он не знает. Проверено следом в журнале: цепочка
    // доходила до конца, лист не показывался.
    const timer = setTimeout(() => {
      if (clientId) {
        // Клиент уже известен — пришли с карточки клиента или вернулись,
        // заведя нового. Первое звено пройдено, показываем второе.
        setChainStep("services");
        return;
      }
      setChainStep("client");
      setClientPickerOpen(true);
    }, CHAIN_START_MS);
    return () => clearTimeout(timer);
  }, [chainStep, isEdit, kind, referencesPending, clientId, setChainStep, setClientPickerOpen]);

  // ВТОРОЕ ЗВЕНО — УСЛУГИ. Ждём прайс: он не в числе базовых справочников,
  // и лист, открытый до его приезда, показывал честную на вид пустоту
  // «У команды пока нет услуг». ПУСТОЙ ПРАЙС НЕ ОТКРЫВАЕМ ВОВСЕ: лист, в
  // котором нечего выбрать, — это экран, который человек только закрывает
  // (поймано на симуляторе 2026-09-03 у команды без единой услуги). Строка
  // «Выбрать услугу» на форме остаётся в одном тапе.
  useEffect(() => {
    if (chainStep !== "services") return;
    if (servicesPending) return;
    setChainStep("done");
    if (serviceIdsCount === 0 && teamServicesCount > 0) {
      setServicePickerOpen(true);
    }
  }, [chainStep, servicesPending, serviceIdsCount, teamServicesCount, setChainStep, setServicePickerOpen]);
}
