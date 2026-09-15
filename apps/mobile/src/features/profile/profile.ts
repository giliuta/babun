// ЛИЧНЫЙ ПРОФИЛЬ — ЧИСТЫЙ СЛОЙ (Кабинет = личное; 007 и 008, 15.09).
//
// Имя и телефон живут в `user_metadata` аккаунта: имя пишет регистрация
// (`full_name`), телефон — страница «Профиль» (`phone` в E.164 и
// `phone_verified: false` до SMS). `list_members` читает оттуда же, пока у
// человека нет карточки сотрудника; с карточкой владелец видит в «Мастерах»
// её имя и телефон — те, что написал в приглашении (15.09).
//
// Лист без React и без сети: разбор метаданных и решение «что сохранить из
// поля телефона» проверяются тестом.

import { DEFAULT_COUNTRY, isDialOnly, tryToE164 } from "../clients/phone";

export interface PersonalProfile {
  name: string;
  /** E.164 или пусто. */
  phone: string;
  phoneVerified: boolean;
}

export function profileFromMetadata(meta: unknown): PersonalProfile {
  const row =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return {
    name: text(row.full_name),
    phone: text(row.phone),
    phoneVerified: row.phone_verified === true,
  };
}

/** Что сохранить из поля «Телефон»: пусто или один код страны — снять номер
 *  (`null`); настоящий номер — E.164; мусор — `undefined`: не сохраняем, а
 *  говорим, что номер не похож на телефон. */
export function phoneToSave(input: string): string | null | undefined {
  if (!input.trim() || isDialOnly(input, DEFAULT_COUNTRY)) return null;
  return tryToE164(input) ?? undefined;
}
