import type { TourChapter } from "@/components/tour/tour-store";

// ГЛАВА «КАЛЕНДАРЬ». Три части по порядку экранов:
//   1. создание первого календаря — кнопка, шторка с именем и цветом;
//   2. сетка — что где на главном экране;
//   3. настройки — шестерёнка и строки, которые стоит настроить сразу.
// Если календарь уже есть (вернулись после перезапуска), глава начинается
// со второй части: `CALENDAR_GRID_START`.
//
// Фраза шага говорит, ЗАЧЕМ эта вещь в работе, и, если надо, что нажать.
// Цели — имена `TourTarget` на экранах календаря.

export const CALENDAR_GRID_START = "cal.chips";

export const CALENDAR_CHAPTER: TourChapter = {
  id: "calendar",
  about: "по календарю",
  steps: [
    {
      id: "cal.create",
      target: "calendar.first-create",
      kind: "tap",
      required: true,
      text: "Добро пожаловать! Начнём с календаря — в нём вся работа. Нажмите «Создать календарь».",
    },
    {
      id: "cal.name",
      target: "calendar-sheet.name",
      kind: "input",
      fallback: "cal.create",
      required: true,
      needs: "calendar-name",
      text: "Придумайте имя календаря: название бизнеса, бригады или просто ваше имя.",
    },
    {
      id: "cal.color",
      target: "calendar-sheet.color",
      kind: "tap",
      fallback: "cal.create",
      text: "Нажмите на квадрат и выберите цвет: им календарь отмечен в ленте и на записях.",
    },
    {
      id: "cal.submit",
      target: "calendar-sheet.submit",
      kind: "tap",
      fallback: "cal.create",
      required: true,
      waitFor: "calendar-created",
      keepVisible: "calendar-sheet.name",
      text: "Всё готово — нажмите «Создать календарь».",
    },
    {
      id: CALENDAR_GRID_START,
      target: "calendar.chips",
      kind: "info",
      optional: true,
      text: "Это ваш календарь. Когда календарей станет несколько, они будут здесь — нажатие переключает между ними.",
    },
    {
      id: "cal.grid",
      target: "calendar.grid",
      kind: "info",
      optional: true,
      text: "Белое — рабочее время, тёмное — нерабочее, бледное — уже прошедшее. Нажмите на свободное время, чтобы создать запись.",
    },
    {
      id: "cal.days",
      target: "calendar.days",
      kind: "info",
      optional: true,
      text: "Нажмите на число, чтобы пометить день: город, район, выезд. Долгое нажатие открывает день целиком.",
    },
    {
      id: "cal.title",
      target: "calendar.title",
      kind: "info",
      optional: true,
      text: "Нажмите на месяц, чтобы перейти к любой дате.",
    },
    {
      id: "cal.view",
      target: "calendar.view",
      kind: "info",
      optional: true,
      text: "Здесь меняется вид: день, неделя, месяц или список.",
    },
    {
      id: "cal.gear",
      target: "calendar.gear",
      kind: "tap",
      required: true,
      text: "Теперь настроим календарь. Нажмите на шестерёнку.",
    },
    {
      id: "set.timezone",
      target: "settings.timezone",
      kind: "tap",
      fallback: "cal.gear",
      optional: true,
      text: "«Часовой пояс» задаёт, где кончается «сегодня» — в календаре, финансах и отчётах. Нажмите и выберите свой.",
    },
    {
      id: "set.hours",
      target: "settings.hours",
      kind: "tap",
      fallback: "cal.gear",
      optional: true,
      text: "«Часы календаря» — какие часы суток видны на сетке и насколько она крупная. Нажмите и настройте.",
    },
    {
      id: "set.schedule",
      target: "settings.schedule",
      kind: "tap",
      fallback: "cal.gear",
      optional: true,
      text: "«График команды» — рабочие дни и часы. Свободные окна для записи ищутся только в рабочем времени. Нажмите и настройте.",
    },
    {
      id: "set.records",
      target: "settings.records",
      kind: "info",
      fallback: "cal.gear",
      optional: true,
      text: "«Записи» — цвет записи на сетке и блоки её формы: клиент, объект, услуги, оплата.",
    },
    {
      id: "set.services",
      target: "settings.services",
      kind: "info",
      fallback: "cal.gear",
      optional: true,
      text: "«Услуги» — ваш прайс: работы, цены и длительность. В записи услугу выбирают отсюда.",
    },
    {
      id: "set.labels",
      target: "settings.labels",
      kind: "info",
      fallback: "cal.gear",
      optional: true,
      text: "«Метки» — слова для дней календаря: города, районы, выезды.",
    },
    {
      id: "set.sms",
      target: "settings.sms",
      kind: "info",
      fallback: "cal.gear",
      optional: true,
      text: "«SMS» — сообщения клиентам: имя отправителя и шаблоны. Календарь настроен.",
    },
  ],
};
