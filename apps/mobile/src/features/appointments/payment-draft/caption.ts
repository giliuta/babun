// Caption under the «Оплата» block title. Pure: no network, no React.

/** `warning` — долг и остаток: янтарь, как у долгов в финансах и карточке
 *  клиента (долг жёлтым или оранжевым — правило). */
export type CaptionTone = "neutral" | "success" | "warning";

/** Подпись под заголовком блока — одно-два слова и число, без объяснений
 *  (есть остаток — пишем просто остаток). */
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
  /** Визит отменён (или деньги возвращены): сервер оплату не примет. */
  visitCancelled?: boolean;
}): { text: string; tone: CaptionTone } | null {
  if (!input.hasTeam) return { text: "Выберите команду", tone: "neutral" };
  // ПЕРЕПЛАТА ВАЖНЕЕ «ОПЛАЧЕНО»: клиент уже оплатил, а итог потом можно
  // поменять. Если итог опущен ниже оплаченного и запись показывает
  // «Оплачено», лишние деньги молча лежат на счёте (долг зажат через
  // max(0, …)). Поэтому переплата называет себя и ждёт решения.
  if ((input.overpaid ?? 0) > 0 && input.overpaidLabel) {
    return { text: `Переплата ${input.overpaidLabel}`, tone: "warning" };
  }
  // ОТМЕНЁННЫЙ ВИЗИТ — НЕ ДОЛГ. Остаток у него считается
  // как у живого, и строка звала «Долг €…», а плитки ждали денег, которые
  // сервер отобьёт: «По отменённой заявке оплату не записать».
  if (input.visitCancelled) {
    return { text: "Визит отменён", tone: "neutral" };
  }
  // НЕСОХРАНЁННАЯ ПРАВКА (итог, клиент, дата, время) СТРОКОЙ НЕ ВИСИТ: о ней
  // скажет тост на тап по плитке (`payment-actions`) — владелец не хочет
  // постоянных предупреждений на странице записи.
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
  // а не молчит (пустая строка над плитками читалась бы как недогрузившийся блок).
  if (input.outstanding > 0) {
    return { text: `К оплате ${input.outstandingLabel}`, tone: "neutral" };
  }
  return null;
}
