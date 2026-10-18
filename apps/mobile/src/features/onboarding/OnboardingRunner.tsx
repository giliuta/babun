import { useEffect, useRef } from "react";
import { setTourFinishHandler, startTour, useTour } from "@/components/tour/tour-store";
import { useTeams } from "@/features/reference/queries";
import { CALENDAR_CHAPTER, CALENDAR_GRID_START } from "./calendar-chapter";
import { nextChapter, useMarkOnboardingDone, useOnboardingDone, type ChapterId } from "./use-onboarding";

/** Запускает следующую непройденную главу обучения и записывает в базу
 *  пройденные. Своего вида нет: подсказки рисует `TourLayer`. */
export function OnboardingRunner() {
  const { data: done } = useOnboardingDone();
  const teams = useTeams();
  const mark = useMarkOnboardingDone();
  const { mutate } = mark;
  const tour = useTour();
  const started = useRef<ChapterId | null>(null);

  useEffect(() => {
    setTourFinishHandler((chapterId, how) => mutate(how === "all" ? "all" : (chapterId as ChapterId)));
    return () => setTourFinishHandler(null);
  }, [mutate]);

  const chapter = nextChapter(done);
  const teamCount = teams.data?.length ?? 0;
  useEffect(() => {
    if (!chapter || tour.chapter || !teams.isSuccess) return;
    // Глава запускается один раз за жизнь приложения: закрытую крестиком
    // база уже отметила, а прерванную (ушли на другой экран) не навязываем
    // снова, пока приложение не перезапустят.
    if (started.current === chapter) return;
    started.current = chapter;
    if (chapter === "calendar") {
      // Календарь уже есть — создавать нечего, глава идёт с сетки.
      startTour(CALENDAR_CHAPTER, teamCount === 0 ? undefined : CALENDAR_GRID_START);
    }
  }, [chapter, tour.chapter, teams.isSuccess, teamCount]);

  return null;
}
