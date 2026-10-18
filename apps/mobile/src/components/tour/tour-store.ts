import { useSyncExternalStore } from "react";
import type { ScrollView, View } from "react-native";

// ОБУЧЕНИЕ — КАК В ИГРЕ. Одно состояние на приложение: какая глава идёт и на
// каком она шаге. Шаг подсвечивает НАСТОЯЩИЙ элемент экрана (обёрнутый в
// `TourTarget`), остальной экран затемнён и не нажимается.
//
// Виды шагов:
//   • info  — пояснение: подсвеченное не нажимается, дальше — «Дальше»;
//   • tap   — «нажмите сюда»: подсвеченное пульсирует и нажимается, шаг идёт
//             дальше по нажатию (или по событию приложения `waitFor`);
//   • input — «заполните»: подсвеченное нажимается, дальше — «Дальше».
//
// Хранилище не знает ни про календарь, ни про финансы: главы пишут фичи
// (`features/onboarding`), здесь только движок.

export type TourStepKind = "info" | "tap" | "input";

export interface TourStep {
  id: string;
  /** Имя `TourTarget`, который подсвечивается. */
  target: string;
  text: string;
  kind: TourStepKind;
  /** Шаг закрывает событие приложения («календарь создан»), а не нажатие. */
  waitFor?: string;
  /** Без этого шага дальше не пройти: «Пропустить» не показывается. */
  required?: boolean;
  /** Элемента может не быть на экране (другой вид календаря, нет права):
   *  тогда шаг пропускается сам. */
  optional?: boolean;
}

export interface TourChapter {
  id: string;
  /** «по календарю» — для вопроса «Завершить обучение по календарю?». */
  about: string;
  steps: readonly TourStep[];
}

export type TourFinish = "chapter" | "all";

type TourScroll = { ref: { current: ScrollView | null }; y: { current: number } };
type TargetEntry = { node: View; host: string; scroll: TourScroll | null };

let chapter: TourChapter | null = null;
let index = 0;
let version = 0;
let onFinish: ((chapterId: string, how: TourFinish) => void) | null = null;
const targets = new Map<string, TargetEntry>();
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTourFinishHandler(handler: typeof onFinish): void {
  onFinish = handler;
}

export function startTour(next: TourChapter, fromStepId?: string): void {
  const at = fromStepId ? next.steps.findIndex((s) => s.id === fromStepId) : 0;
  chapter = next;
  index = Math.max(0, at);
  emit();
}

/** Глава закончена: последний шаг пройден или человек нажал крестик. */
export function finishTour(how: TourFinish = "chapter"): void {
  const done = chapter;
  chapter = null;
  index = 0;
  emit();
  if (done) onFinish?.(done.id, how);
}

export function nextStep(): void {
  if (!chapter) return;
  if (index + 1 >= chapter.steps.length) finishTour();
  else {
    index++;
    emit();
  }
}

export function activeStep(): TourStep | null {
  return chapter ? (chapter.steps[index] ?? null) : null;
}

/** Событие приложения: шаг, который его ждёт, идёт дальше. */
export function tourEvent(name: string): void {
  if (activeStep()?.waitFor === name) nextStep();
}

/** Нажали подсвеченный элемент. Дальше — после самого нажатия, иначе слой
 *  следующего шага ляжет раньше, чем экран ответит на касание. */
export function tourTargetTapped(id: string): void {
  const step = activeStep();
  if (!step || step.target !== id || step.kind !== "tap" || step.waitFor) return;
  setTimeout(() => {
    if (activeStep() === step) nextStep();
  }, 0);
}

export function registerTourTarget(id: string, entry: TargetEntry | null): void {
  const had = targets.get(id);
  if (entry) {
    if (had?.node === entry.node && had.host === entry.host) return;
    targets.set(id, entry);
  } else {
    if (!had) return;
    targets.delete(id);
  }
  // Подписчикам нужно знать только о цели активного шага.
  if (activeStep()?.target === id) emit();
}

export function tourTarget(id: string): TargetEntry | undefined {
  return targets.get(id);
}

export type TourSnapshot = {
  chapter: TourChapter | null;
  step: TourStep | null;
  index: number;
  total: number;
  version: number;
};

let snapshot: TourSnapshot = { chapter: null, step: null, index: 0, total: 0, version: -1 };

function read(): TourSnapshot {
  if (snapshot.version !== version) {
    snapshot = {
      chapter,
      step: activeStep(),
      index,
      total: chapter?.steps.length ?? 0,
      version,
    };
  }
  return snapshot;
}

export function useTour(): TourSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

export type { TourScroll };
