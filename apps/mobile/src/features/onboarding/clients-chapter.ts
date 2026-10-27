import type { TourChapter } from "@/components/tour/tour-store";

// ГЛАВА «КЛИЕНТЫ». Две части:
//   1. первый клиент — кнопка списка, карточка нового клиента (имя, телефон),
//      «Создать клиента», возврат к списку;
//   2. список — поиск, фильтры, строка клиента, шестерёнка.
// Создать клиента предлагается всегда: кнопка внизу списка есть и у пустого,
// и у полного, а свой первый клиент — лучший способ увидеть карточку.
//
// Цели — имена `TourTarget` в списке клиентов и в карточке.

export const CLIENTS_CHAPTER: TourChapter = {
  id: "clients",
  about: "по клиентам",
  steps: [
    {
      id: "cli.create",
      target: "clients.create",
      kind: "tap",
      required: true,
      text: "Клиенты — ваша база контактов: кто где живёт и что вы для него делали. Нажмите «Создать клиента».",
    },
    {
      id: "cli.name",
      target: "client.name",
      kind: "input",
      fallback: "cli.create",
      required: true,
      needs: "client-name",
      text: "Имя клиента или название компании — по нему клиента находят поиском и подставляют в SMS.",
    },
    {
      id: "cli.phone",
      target: "client.phone",
      kind: "input",
      fallback: "cli.create",
      text: "Телефон — по нему звонят и пишут в одно касание. Номер можно не указывать.",
    },
    {
      id: "cli.submit",
      target: "client.create-submit",
      kind: "tap",
      fallback: "cli.create",
      required: true,
      waitFor: "client-created",
      text: "Нажмите «Создать клиента». Остальные блоки карточки — объекты, заметку, файлы — можно заполнить потом.",
    },
    {
      id: "cli.back",
      target: "client.back",
      kind: "tap",
      required: true,
      text: "Клиент создан. Нажмите «назад» — вернёмся к списку.",
    },
    {
      id: "cli.search",
      target: "clients.search",
      kind: "info",
      optional: true,
      text: "Поиск по имени, телефону и адресу.",
    },
    {
      id: "cli.filters",
      target: "clients.filters",
      kind: "info",
      optional: true,
      text: "Фильтры оставляют в списке только нужных: по статусу, метке, тегам, команде, источнику. Включённый фильтр отмечен точкой.",
    },
    {
      id: "cli.row",
      target: "clients.row",
      kind: "info",
      optional: true,
      text: "Строка клиента: нажмите, чтобы открыть карточку. Смахните вправо — напомнить, влево — удалить; долгое нажатие открывает меню.",
    },
    {
      id: "cli.gear",
      target: "clients.gear",
      kind: "info",
      optional: true,
      text: "Шестерёнка — настройки клиентов: что видно в строке, способы связи, объекты и блоки карточки.",
    },
  ],
};
