// Visible window fallback — mirrors shared DEFAULT_CALENDAR_SETTINGS
// (startHour 0 / endHour 24): the grid shows the whole day, work hours
// only drive the grey off-hours wash.
export const DEFAULT_START = 0;
export const DEFAULT_END = 24;
// Snap granularity fallback. Календарь передаёт константные 15 мин
// (настройка «Шаг сетки» удалена — см. stepMinutes в index.tsx); драг и
// тап по пустому слоту снапятся к нему, кламп 5–60.
export const DEFAULT_STEP = 30;
// Получасовая волосяная линия В КОЛОНКЕ появляется, когда час достаточно
// высок, чтобы она читалась, а не сливалась в шум. Порог по КОММИЧЕННОМУ
// hourH — как и текст-фит блоков, линия догоняет зум на отпускании.
// На рельсе подписей «HH:30» нет вовсе (запрос владельца 2026-07-27:
// «только часовая») — время между часами называет красная капсула «сейчас».
export const HALF_MARK_MIN_H = 52;
