// v547 §3.10 — preset library for SMS templates.
//
// Per the audit plan: «Дать готовые шаблоны по умолчанию для каждого
// триггера (нажать "Применить")». Each TemplateKind gets 2-3 presets
// that the editor can render as «Применить» chips so the dispatcher
// has somewhere to start.
//
// Each preset has a `name` that auto-fills the template name field
// when applied AND a `body` that auto-fills the message. Body uses
// the same token syntax as the runtime renderer ([Имя], [Дата],
// [Время], etc — see AVAILABLE_TOKENS in sms-templates.ts).
//
// Bodies stay short on purpose — under 160 GSM-7 chars or under 70
// UCS-2 chars where feasible — so the «Применить» click results in
// a 1-segment SMS by default. The dispatcher can always lengthen.

import type { TemplateKind } from "./sms-templates";

export interface SmsPreset {
  /** Short display label shown on the «Применить» chip. */
  label: string;
  /** Default name for the template record (filled into the «Название»
   *  input when applied). */
  name: string;
  /** Message body — same token syntax as AVAILABLE_TOKENS. */
  body: string;
}

export const SMS_PRESETS: Record<TemplateKind, SmsPreset[]> = {
  new_appointment: [
    {
      label: "Короткое подтверждение",
      name: "Подтверждение записи",
      body: "[Имя], запись подтверждена: [Дата] в [Время]. [Компания]",
    },
    {
      label: "С адресом и услугой",
      name: "Подтверждение и детали",
      body: "[Имя], ждём вас [Дата] в [Время] по адресу [Адрес]. Услуга: [Услуга]. [Компания]",
    },
    {
      label: "С ценой",
      name: "Подтверждение и цена",
      body: "[Имя], записали на [Дата] [Время]. [Услуга] — [Цена]. [Компания]",
    },
  ],

  reminder: [
    {
      label: "За день",
      name: "Напоминание за 24 ч",
      body: "[Имя], напоминаем: завтра в [Время] у вас [Услуга]. [Компания]",
    },
    {
      label: "За пару часов",
      name: "Напоминание за 2 ч",
      body: "[Имя], через 2 часа ждём вас на [Услуга] в [Время]. Адрес: [Адрес]",
    },
  ],

  after_24h_short: [
    {
      label: "Спасибо",
      name: "Спасибо после визита",
      body: "[Имя], спасибо что выбрали нас сегодня. Будем рады новой встрече! [Компания]",
    },
    {
      label: "Спасибо и отзыв",
      name: "Просьба об отзыве",
      body: "[Имя], спасибо за визит! Если всё понравилось — оставьте отзыв, нам это очень поможет.",
    },
  ],

  after_24h_long: [
    {
      label: "Запись через месяц",
      name: "Возврат — месяц",
      body: "[Имя], уже месяц! Время для следующего визита. Запишем когда удобно?",
    },
    {
      label: "Сезонное напоминание",
      name: "Сезонная чистка",
      body: "[Имя], скоро [Услуга] — сезон начинается. Когда удобно записать?",
    },
  ],

  cancellation: [
    {
      label: "Жаль",
      name: "Подтверждение отмены",
      body: "[Имя], отмена записи на [Дата] [Время] принята. Жаль, что не получилось — запишемся в другой раз?",
    },
    {
      label: "Перенос предложен",
      name: "Отмена и перенос",
      body: "[Имя], отмена принята. Можем перенести на другой день — напишите когда удобно.",
    },
  ],

  waitlist: [
    {
      label: "Появилось окно",
      name: "Окно в листе ожидания",
      body: "[Имя], появилось окно [Дата] в [Время]. Подходит? Ответьте «Да» чтобы записать.",
    },
    {
      label: "Через неделю",
      name: "Ждём вашу запись",
      body: "[Имя], вы в списке ожидания на [Услуга]. Свяжемся, как только появится свободный слот.",
    },
  ],

  // C1 — пользовательский шаблон «долг». [Сумма] = размер долга (напр.
  // «€80»), [Имя] = имя клиента. Первый пресет — дефолтная формулировка,
  // совпадающая с зашитым debtReminderSms (тот остаётся фолбэком, если
  // шаблон не заведён).
  debt: [
    {
      label: "Напоминание о долге",
      name: "Напоминание о долге",
      body: "Здравствуйте, [Имя]! Напоминаем об оплате [Сумма]. Спасибо!",
    },
    {
      label: "Коротко",
      name: "Долг — коротко",
      body: "[Имя], за вами числится оплата [Сумма]. Будем благодарны за погашение.",
    },
  ],
};

/** Helper for the editor — returns presets for the active kind. */
export function getSmsPresets(kind: TemplateKind): SmsPreset[] {
  return SMS_PRESETS[kind] ?? [];
}
