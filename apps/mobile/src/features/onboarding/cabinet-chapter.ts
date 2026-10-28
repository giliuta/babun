import type { TourChapter } from "@/components/tour/tour-store";

// ГЛАВА «КАБИНЕТ» — последняя, одни пояснения: нажимать здесь ничего не
// нужно, Кабинет — это то, что принадлежит человеку и телефону, а не работа.
// Строки — сверху вниз, как на экране; обучение докручивает к нижним.
//
// Цели — имена `TourTarget` на корне Кабинета и в `OwnAccountSection`.

export const CABINET_CHAPTER: TourChapter = {
  id: "cabinet",
  about: "по кабинету",
  steps: [
    {
      id: "cab.profile",
      target: "cabinet.profile",
      kind: "info",
      optional: true,
      text: "Кабинет — ваш аккаунт, команды и этот телефон. Сверху — профиль: имя и контакты.",
    },
    {
      id: "cab.invitations",
      target: "cabinet.invitations",
      kind: "info",
      optional: true,
      text: "«Приглашения» — сюда приходят приглашения в чужие команды.",
    },
    {
      id: "cab.tariff",
      target: "cabinet.tariff",
      kind: "info",
      optional: true,
      text: "«Тариф» — платите за календари, люди в командах бесплатно.",
    },
    {
      id: "cab.partners",
      target: "cabinet.partners",
      kind: "info",
      optional: true,
      text: "«Партнёры» — люди в ваших командах. Пригласите сотрудника и отметьте, что ему можно видеть и менять в каждой команде.",
    },
    {
      id: "cab.requisites",
      target: "cabinet.requisites",
      kind: "info",
      optional: true,
      text: "«Реквизиты» — данные для инвойсов и чеков.",
    },
    {
      id: "cab.history",
      target: "cabinet.history",
      kind: "info",
      optional: true,
      text: "«История изменений» — кто и что менял во всех календарях.",
    },
    {
      id: "cab.sms",
      target: "cabinet.sms",
      kind: "info",
      optional: true,
      text: "«SMS» — баланс сообщений. Шаблоны текста — в настройках календаря.",
    },
    {
      id: "cab.export",
      target: "cabinet.export",
      kind: "info",
      optional: true,
      text: "«Выгрузка данных» — клиенты, записи и финансы в CSV, каждый своим файлом.",
    },
    {
      id: "cab.notifications",
      target: "cabinet.notifications",
      kind: "info",
      optional: true,
      text: "«Уведомления» — о каких делах команды сообщать на этот телефон.",
    },
    {
      id: "cab.languages",
      target: "cabinet.languages",
      kind: "info",
      optional: true,
      text: "«Языки» — язык приложения на этом телефоне.",
    },
    {
      id: "cab.account",
      target: "cabinet.account",
      kind: "info",
      optional: true,
      text: "«Вход и безопасность» — пароль, устройства, удаление аккаунта. Обучение пройдено — все разделы открыты.",
    },
  ],
};
