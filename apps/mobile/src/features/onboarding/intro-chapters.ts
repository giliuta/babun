import type { TourChapter } from "@/components/tour/tour-store";
import type { TabWithChapter } from "./chapter-order";

// ВСТУПЛЕНИЯ К ГЛАВАМ. Глава раздела идёт на его экране, а человек в этот
// момент на другом: только что закончил календарь в его настройках. Вместо
// того чтобы ждать, пока он сам найдёт открывшуюся вкладку, вступление
// подсвечивает её и просит нажать — как в игре, где открывшийся уровень
// мигает на карте. Нажал — открылся раздел, и глава идёт уже там.

export const INTRO_CHAPTERS: Record<TabWithChapter, TourChapter> = {
  finances: {
    id: "finances.intro",
    intro: "finances",
    about: "по финансам",
    steps: [
      {
        id: "fin.tab",
        target: "tab.finances",
        kind: "tap",
        required: true,
        text: "Открылся раздел «Финансы». Нажмите на него — покажу, как вести деньги.",
      },
    ],
  },
  clients: {
    id: "clients.intro",
    intro: "clients",
    about: "по клиентам",
    steps: [
      {
        id: "cli.tab",
        target: "tab.clients",
        kind: "tap",
        required: true,
        text: "Открылся раздел «Клиенты». Нажмите на него — покажу, как вести базу клиентов.",
      },
    ],
  },
  cabinet: {
    id: "cabinet.intro",
    intro: "cabinet",
    about: "по кабинету",
    steps: [
      {
        id: "cab.tab",
        target: "tab.cabinet",
        kind: "tap",
        required: true,
        text: "Остался «Кабинет». Нажмите на него — там аккаунт, команда и настройки.",
      },
    ],
  },
};
