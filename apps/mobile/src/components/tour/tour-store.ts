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
  /** «Дальше» гаснет, пока экран не сообщит, что готово (`setTourReady`):
   *  без имени календаря идти к цвету и кнопке «Создать» незачем. */
  needs?: string;
  /** Цель, которую пузырь не должен закрывать: на шаге «нажмите
   *  „Создать“» человек должен видеть строку с именем и цветом, которые он
   *  только что выбрал. */
  keepVisible?: string;
}

export interface TourChapter {
  id: string;
  /** «по календарю» — для вопроса «Завершить обучение по календарю?». */
  about: string;
  steps: readonly TourStep[];
  /** ВСТУПЛЕНИЕ К ГЛАВЕ: «открылся раздел — нажмите на него». Само по себе
   *  ничего не проходит: дойти до конца вступления — значит открыть раздел,
   *  а не пройти главу. Крестик на нём закрывает главу `intro`. */
  intro?: string;
}

/** Как закончилась глава: дошли до конца, закрыли её крестиком или закрыли
 *  крестиком всё обучение. */
export type TourFinish = "end" | "chapter" | "all";

type TourScroll = { ref: { current: ScrollView | null }; y: { current: number } };
/** Как подсвечивать цель — по её форме, чтобы вырез лёг ровно по элементу:
 *   • card    — строка в карточке: вырез по краю карточки, её скругление;
 *   • control — кнопка, плитка, значок: ровный отступ вокруг и скругление;
 *   • strip   — полоса во всю ширину (лента, сетка): без скругления. */
export type TourShape = "card" | "control" | "strip";

type TargetEntry = { node: View; host: string; scroll: TourScroll | null; shape: TourShape };

let chapter: TourChapter | null = null;
let index = 0;
/** С какого шага глава началась: «Шаг 1» — это первый показанный шаг, а не
 *  первый в списке (глава со страницы раздела пропускает создание). */
let startIndex = 0;
let version = 0;
let onFinish: ((chapter: TourChapter, how: TourFinish) => void) | null = null;
const ready = new Map<string, boolean>();
const targets = new Map<string, TargetEntry>();
const listeners = new Set<() => void>();
/** Отдельно от шага: чтобы запустить главу, когда её первая цель появилась
 *  на экране, не будя слой подсказки на каждую строку, вставшую в реестр. */
let targetsVersion = 0;
const targetListeners = new Set<() => void>();

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
  startIndex = index;
  emit();
}

/** Глава закончена: последний шаг пройден или человек нажал крестик. */
export function finishTour(how: TourFinish): void {
  const done = chapter;
  chapter = null;
  index = 0;
  emit();
  if (done) onFinish?.(done, how);
}

export function nextStep(): void {
  if (!chapter) return;
  if (index + 1 >= chapter.steps.length) finishTour("end");
  else {
    index++;
    emit();
  }
}

/** Экран сообщает, готово ли то, чего ждёт шаг (`TourStep.needs`). */
export function setTourReady(key: string, value: boolean): void {
  if (ready.get(key) === value) return;
  ready.set(key, value);
  if (activeStep()?.needs === key) emit();
}

export function tourReady(key: string | undefined): boolean {
  return key ? ready.get(key) === true : true;
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

export function registerTourTarget(id: string, entry: TargetEntry): void {
  const had = targets.get(id);
  if (
    had?.node === entry.node &&
    had.host === entry.host &&
    had.scroll === entry.scroll &&
    had.shape === entry.shape
  ) {
    return;
  }
  targets.set(id, entry);
  targetsChanged(id);
}

/** Цель ушла с экрана. Снимается только сама: при замене экрана (`replace`)
 *  обёртка нового встаёт раньше, чем уходит старая с тем же именем, и стирать
 *  новую нельзя — шаг потерял бы цель и встал бы навсегда. */
export function unregisterTourTarget(id: string, node: View): void {
  if (targets.get(id)?.node !== node) return;
  targets.delete(id);
  targetsChanged(id);
}

function targetsChanged(id: string): void {
  targetsVersion++;
  for (const listener of targetListeners) listener();
  // Слою подсказки нужно знать только о цели активного шага.
  if (activeStep()?.target === id) emit();
}

export function tourTarget(id: string): TargetEntry | undefined {
  return targets.get(id);
}

/** Открыт ли экран цели: есть ли на экране хоть одна цель того же экрана
 *  (`settings.hours` → любая `settings.*`). Необязательный шаг пропускается
 *  сам, только когда экран открыт, а строки на нём нет (закрыта правом или
 *  тарифом). Ушёл человек с экрана — шаг ждёт, а не проскакивает. */
export function tourScreenShown(id: string): boolean {
  const screen = id.split(".")[0] + ".";
  for (const key of targets.keys()) if (key.startsWith(screen)) return true;
  return false;
}

function subscribeTargets(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => targetListeners.delete(listener);
}

const readTargetsVersion = () => targetsVersion;

/** Меняется, когда цель встала на экран или ушла с него. */
export function useTourTargetsVersion(): number {
  return useSyncExternalStore(subscribeTargets, readTargetsVersion, readTargetsVersion);
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
      index: index - startIndex,
      total: (chapter?.steps.length ?? 0) - startIndex,
      version,
    };
  }
  return snapshot;
}

/** Снимок без подписки — для проверок и кода вне React. */
export function tourSnapshot(): TourSnapshot {
  return read();
}

export function useTour(): TourSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

export type { TourScroll };
