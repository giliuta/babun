import { useEffect, useRef } from "react";
import { useSegments } from "expo-router";
import {
  setTourFinishHandler,
  startTour,
  tourTarget,
  useTour,
  useTourTargetsVersion,
  type TourChapter,
} from "@/components/tour/tour-store";
import { useTeams } from "@/features/reference/queries";
import { CABINET_CHAPTER } from "./cabinet-chapter";
import { CALENDAR_CHAPTER, CALENDAR_GRID_START } from "./calendar-chapter";
import { CLIENTS_CHAPTER } from "./clients-chapter";
import { FINANCES_CHAPTER, FINANCES_PAGE_START } from "./finances-chapter";
import { INTRO_CHAPTERS } from "./intro-chapters";
import { progressToSave } from "./chapter-order";
import { nextChapter, useMarkOnboardingDone, useOnboardingDone, type ChapterId } from "./use-onboarding";

/** Глава раздела стартует, когда человек впервые открыл его вкладку и на
 *  экране встала одна из её начальных целей. Цель решает, с какого шага:
 *  пустые Финансы — с создания счёта, Финансы со счётом — со страницы.
 *  Ждать цель, а не только адрес, нужно потому, что экран вкладки сперва
 *  грузится, и подсвечивать в нём ещё нечего. */
type ChapterEntry = {
  chapter: TourChapter;
  tab: string;
  starts: readonly { target: string; from?: string }[];
};

const ENTRIES: Partial<Record<ChapterId, ChapterEntry>> = {
  finances: {
    chapter: FINANCES_CHAPTER,
    tab: "finances",
    starts: [{ target: "finances.first-create" }, { target: "finances.tiles", from: FINANCES_PAGE_START }],
  },
  clients: {
    chapter: CLIENTS_CHAPTER,
    tab: "clients",
    starts: [{ target: "clients.create" }],
  },
  cabinet: {
    chapter: CABINET_CHAPTER,
    tab: "cabinet",
    starts: [{ target: "cabinet.profile" }],
  },
};

/** Запускает следующую непройденную главу обучения и записывает в базу
 *  пройденные. Своего вида нет: подсказки рисует `TourLayer`. */
export function OnboardingRunner() {
  const { data: done } = useOnboardingDone();
  const teams = useTeams();
  const mark = useMarkOnboardingDone();
  const { mutate } = mark;
  const tour = useTour();
  // Без сгенерированных типов маршрутов (CI) `useSegments()` — кортеж из
  // одного элемента; путь читаем как обычный список.
  const segments: readonly string[] = useSegments();
  const targetsVersion = useTourTargetsVersion();
  const started = useRef<ChapterId | null>(null);
  const introduced = useRef<ChapterId | null>(null);

  useEffect(() => {
    setTourFinishHandler((finished, how) => {
      const save = progressToSave(finished, how);
      if (save) mutate(save);
    });
    return () => setTourFinishHandler(null);
  }, [mutate]);

  const chapter = nextChapter(done);
  const teamCount = teams.data?.length ?? 0;
  // Корень вкладки: `["(dashboard)", "finances"]`. Глубже (настройки
  // раздела) экран вкладки остаётся смонтированным под страницей, и его цели
  // в реестре есть, но подсвечивать их сквозь чужую страницу нельзя.
  const tab = segments.length === 2 ? segments[1] : null;

  useEffect(() => {
    if (!chapter || tour.chapter || !teams.isSuccess) return;
    // Глава запускается один раз за жизнь приложения: закрытую крестиком
    // база уже отметила, а прерванную (ушли на другой экран) не навязываем
    // снова, пока приложение не перезапустят.
    if (started.current === chapter) return;
    if (chapter === "calendar") {
      started.current = chapter;
      // Календарь уже есть — создавать нечего, глава идёт с сетки.
      startTour(CALENDAR_CHAPTER, teamCount === 0 ? undefined : CALENDAR_GRID_START);
      return;
    }
    const entry = ENTRIES[chapter];
    if (!entry) return;
    // Человек не на вкладке главы — сперва вступление: открывшаяся вкладка
    // пульсирует, нажатие на неё приводит туда, где глава и пойдёт.
    if (tab !== entry.tab) {
      if (introduced.current === chapter) return;
      introduced.current = chapter;
      startTour(INTRO_CHAPTERS[chapter as keyof typeof INTRO_CHAPTERS]);
      return;
    }
    const start = entry.starts.find((s) => tourTarget(s.target));
    if (!start) return;
    started.current = chapter;
    startTour(entry.chapter, start.from);
  }, [chapter, tour.chapter, teams.isSuccess, teamCount, tab, targetsVersion]);

  return null;
}
