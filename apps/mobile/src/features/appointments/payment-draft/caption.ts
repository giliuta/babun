// Caption under the «Оплата» block title. Pure: no network, no React.

/** `warning` — долг и остаток: янтарь, как у долгов в финансах и карточке
 *  клиента (владелец 2026-09-06: «долг жёлтым или оранжевым, это правило»). */
export type CaptionTone = "neutral" | "success" | "warning";

/** Подпись под заголовком блока — одно-два слова и число, без объяснений
 *  (владелец 2026-09-06: «если есть остаток — пишем просто остаток»). */
export function blockCaption(input: {
  hasTeam: boolean;
  hasAppointment: boolean;
  visitCompleted: boolean;
  outstanding: number;
  rowsCount: number;
  /** Открыто поле суммы — подпись не нужна, всё говорит само поле. */
  amountMode: boolean;
  started: boolean;
  hasPending: boolean;
  outstandingLabel: string;
  /** Лишние деньги: заплатили больше, чем стоит запись. */
  overpaid?: number;
  overpaidLabel?: string;
  /** Итог в форме уже не тот, что в базе: деньги принимает сервер, а он
   *  считает долг по сохранённой записи. */
  billUnsaved?: boolean;
  /** Клиент в форме сменён, но не сохранён: платёж ушёл бы на запись
   *  ПРЕЖНЕГО клиента и запер бы смену (аудит 2026-10-03). */
  clientUnsaved?: boolean;
  /** Дата или время в форме сменены и не сохранены (`slotUnsaved`). */
  slotUnsaved?: "date" | "time" | null;
  /** Визит отменён (или деньги возвращены): сервер оплату не примет. */
  visitCancelled?: boolean;
}): { text: string; tone: CaptionTone } | null {
  if (!input.hasTeam) return { text: "Выберите команду", tone: "neutral" };
  // ПЕРЕПЛАТА ВАЖНЕЕ «ОПЛАЧЕНО» (владелец 2026-09-10: «а он-то уже
  // зафиксирован, что оплатил, а я потом могу поменять итоговую сумму»).
  // Опустив итог ниже оплаченного, запись показывала «Оплачено», и лишние
  // деньги молча лежали на счёте: долг зажат через max(0, …), а переплаты у
  // записи не было вовсе. Теперь она называет себя и ждёт решения.
  if ((input.overpaid ?? 0) > 0 && input.overpaidLabel) {
    return { text: `Переплата ${input.overpaidLabel}`, tone: "warning" };
  }
  // ДЕНЬГИ ПРИНИМАЕТ СЕРВЕР, А ОН ЧИТАЕТ СОХРАНЁННУЮ ЗАПИСЬ. Дописали услуги —
  // долг уже посчитан по новому итогу (`paymentMath`), но платёж на него
  // сервер отобьёт: в базе ещё прошлая сумма. Строка просит ровно то, что
  // нужно сделать, вместо отказа после тапа.
  // ОТМЕНЁННЫЙ ВИЗИТ — НЕ ДОЛГ (аудит 2026-10-03). Остаток у него считается
  // как у живого, и строка звала «Долг €…», а плитки ждали денег, которые
  // сервер отобьёт: «По отменённой заявке оплату не записать».
  if (input.visitCancelled) {
    return { text: "Визит отменён", tone: "neutral" };
  }
  // Коротко: строка делит ширину со значками «часть» и «инвойс», и полная
  // фраза обрезалась в «сохраните зап…» (проверка на Pro Max 03.10).
  if (input.billUnsaved) {
    return { text: "Итог изменён — сохраните", tone: "warning" };
  }
  // ДЕНЬГИ ЛОЖАТСЯ НА КЛИЕНТА ИЗ БАЗЫ. Выбрали другого и не сохранили —
  // тап записал бы оплату прежнему, а затем «Сохранить» упёрлось бы в
  // «Сначала верните оплату», и вернуть прежнего тоже нельзя: клиента с
  // оплатой не меняют. Выход был один — снять оплату. Просим сохранить ДО.
  if (input.clientUnsaved) {
    return { text: "Клиент изменён — сохраните", tone: "warning" };
  }
  if (input.slotUnsaved) {
    return {
      text: input.slotUnsaved === "date" ? "Дата изменена — сохраните" : "Время изменено — сохраните",
      tone: "warning",
    };
  }
  if (input.hasAppointment && input.outstanding <= 0 && input.rowsCount > 0) {
    return {
      text: input.visitCompleted ? "Оплачено" : "Оплачено заранее",
      tone: "success",
    };
  }
  if (input.amountMode) return null;
  if (input.hasAppointment && input.visitCompleted && input.outstanding > 0) {
    return { text: `Долг ${input.outstandingLabel}`, tone: "warning" };
  }
  if (input.hasAppointment && input.rowsCount > 0 && input.outstanding > 0) {
    return { text: `Остаток ${input.outstandingLabel}`, tone: "warning" };
  }
  if (!input.hasAppointment && input.hasPending) {
    return { text: "Запишется при создании", tone: "neutral" };
  }
  // Визит идёт или запись ещё не создана, денег нет: строка называет сумму,
  // а не молчит (аудит 2026-09-06: пустая строка над плитками читалась как
  // недогрузившийся блок).
  if (input.outstanding > 0) {
    return { text: `К оплате ${input.outstandingLabel}`, tone: "neutral" };
  }
  return null;
}
