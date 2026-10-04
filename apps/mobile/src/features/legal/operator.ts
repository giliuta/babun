import { SUPPORT_CONTACTS } from "@/features/cabinet/help";

// КТО СТОИТ ЗА BABUN — ДЛЯ ПОЛИТИКИ, УСЛОВИЙ И УДАЛЕНИЯ АККАУНТА (04.10).
//
// App Store и Google Play требуют страницы, где названо, кто обрабатывает
// данные и как с ним связаться. Имя, адрес и почту называет владелец —
// выдумывать их нельзя (тот же закон, что у контактов «Помощи»). Почта одна на
// продукт: адрес поддержки из `help.ts`, чтобы «Помощь» и документы не
// разошлись.
//
// Пока поле пусто, страница пишет «—»: такие страницы не выкладываются, пока
// владелец не заполнил всё (сторож — legal-texts.test.ts, проверка `isReady`).

export interface LegalOperator {
  /** Человек или фирма, которая предоставляет сервис: «Babun Ltd». */
  name: string;
  /** Адрес для писем: город и страна как минимум. */
  address: string;
}

// Владелец 04.10: выпускаем от себя (личная лицензия Apple) — имя ровно как в
// аккаунте Apple Developer, его же App Store покажет продавцом.
export const LEGAL_OPERATOR: LegalOperator = {
  name: "Artem Hiliuta",
  address: "",
};

/** Почта для вопросов о данных и удаления аккаунта — та же, что в «Помощи». */
export const legalEmail = (): string => SUPPORT_CONTACTS.email.trim();

/** Заполнено ли всё, без чего документы выкладывать нельзя. */
export function isLegalReady(operator: LegalOperator = LEGAL_OPERATOR, email = legalEmail()): boolean {
  return operator.name.trim() !== "" && operator.address.trim() !== "" && email !== "";
}
