import type { TourChapter } from "@/components/tour/tour-store";

// ГЛАВА «ФИНАНСЫ». Две части по порядку экрана:
//   1. первый счёт — кнопка пустых Финансов, шторка с именем, видом и суммой;
//   2. страница — что где на Финансах, сверху вниз.
// Если счёт уже есть (завели до обучения, вернулись после перезапуска),
// глава начинается со второй части: `FINANCES_PAGE_START`.
//
// Цели — имена `TourTarget` на «Финансах» и в `CreateAccountSheet`.

export const FINANCES_PAGE_START = "fin.period";

export const FINANCES_CHAPTER: TourChapter = {
  id: "finances",
  about: "по финансам",
  steps: [
    {
      id: "fin.create",
      target: "finances.first-create",
      kind: "tap",
      required: true,
      text: "Финансы начинаются со счёта — кассы, карты или банка, куда приходят деньги. Нажмите «Создать счёт».",
    },
    {
      id: "fin.name",
      target: "account.create-name",
      kind: "input",
      fallback: "fin.create",
      required: true,
      needs: "account-name",
      text: "Назовите счёт так, как зовёте его сами: «Касса», «Карта», «Банк».",
    },
    {
      id: "fin.look",
      target: "account.create-look",
      kind: "tap",
      fallback: "fin.create",
      text: "Нажмите на значок слева и выберите цвет и значок: по ним счёт узнаётся в оплате и переводах.",
    },
    {
      id: "fin.opening",
      target: "account.create-opening",
      kind: "input",
      fallback: "fin.create",
      optional: true,
      text: "Сколько денег на счёте сейчас. Не знаете — оставьте пустым, это ноль.",
    },
    {
      id: "fin.submit",
      target: "account.create-submit",
      kind: "tap",
      fallback: "fin.create",
      required: true,
      waitFor: "account-created",
      text: "Всё готово — нажмите «Добавить счёт».",
    },
    {
      id: FINANCES_PAGE_START,
      target: "finances.period",
      kind: "info",
      optional: true,
      text: "Сверху — календарь и период: все цифры ниже считаются по ним. Нажмите на период, чтобы выбрать день, неделю, месяц или свои даты.",
    },
    {
      id: "fin.tiles",
      target: "finances.tiles",
      kind: "info",
      optional: true,
      text: "Главные цифры периода: счета, документы, доход, расход, долги и прибыль. Нажмите на плитку — внизу останется только её список.",
    },
    {
      id: "fin.feed",
      target: "finances.feed",
      kind: "info",
      optional: true,
      text: "Лента операций: оплаты записей, доходы и расходы. Нажмите на строку, чтобы открыть операцию; смахните влево, чтобы удалить.",
    },
    {
      id: "fin.search",
      target: "finances.search",
      kind: "info",
      optional: true,
      text: "Поиск по сумме, счёту и заметке.",
    },
    {
      id: "fin.stats",
      target: "finances.stats",
      kind: "info",
      optional: true,
      text: "Аналитика: откуда приходят деньги и куда уходят за тот же период.",
    },
    {
      id: "fin.action",
      target: "finances.action",
      kind: "info",
      optional: true,
      text: "Кнопка внизу меняется вместе с выбранной плиткой: операция, перевод, инвойс или долг.",
    },
    {
      id: "fin.gear",
      target: "finances.gear",
      kind: "info",
      optional: true,
      text: "Шестерёнка — настройки финансов: счета, категории, валюта и удалённые операции.",
    },
  ],
};
