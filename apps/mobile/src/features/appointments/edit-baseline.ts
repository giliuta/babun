import type { AppointmentStatus } from "@babun/shared/local/appointments";

// СНИМОК «КАК В БАЗЕ» У ОТКРЫТОЙ ЗАПИСИ УЗНАЁТ НОВЫЙ СТАТУС — И ТОЛЬКО ЕГО.
//
// Оплата пишется мимо «Сохранить», и сервер может закрыть визит вместе с
// ней. Форма подхватывает новый статус, а снимок, с которым сравнивается
// подпись формы («есть несохранённое», поля патча сотрудника), обязан
// подхватить его же — иначе статус сам по себе выглядел бы правкой.
//
// Раньше снимок просто обнуляли, и эффект снимал его заново на следующем же
// изменении подписи — уже вместе с несохранёнными правками человека (аудит
// 2026-10-03): «Отмена» закрывала без вопроса, а сотрудник на «Сохранить»
// не отправлял эти правки, получая «Изменения сохранены».
//
// Ключ `status` уже стоит в снимке — замена сохраняет порядок ключей, и
// строка остаётся сравнимой с `JSON.stringify(buildPatch())`.
export function withBaselineStatus(
  baseline: string | null,
  status: AppointmentStatus,
): string | null {
  if (baseline == null) return null;
  const parsed = JSON.parse(baseline) as Record<string, unknown>;
  if (!("status" in parsed)) return baseline;
  return JSON.stringify({ ...parsed, status });
}
