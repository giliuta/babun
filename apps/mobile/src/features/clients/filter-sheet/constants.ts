// Shared numbers of the «Фильтры» sheet and its popups.

export const INK = "#0B1220";
export const SLOT = 92; // боковые слоты шапки: заголовок оптически по центру.
export const GRABBER_H = 19; // язычок листа (высота + его отступы)
export const TOP_GAP = 10; // зазор до статус-бара
/** Доля экрана под лист «Фильтры» (владелец 2026-08-07: «в половину»).
 *  Чуть больше половины: ровно 0.5 обрезает футер «Показать N» на
 *  маленьких экранах, и кнопка уезжала под сгиб. */
export const HALF_RATIO = 0.58;

/** Три формы счётного слова: «клиент / клиента / клиентов». */
export type Noun3 = [string, string, string];
export const CLIENT_NOUN: Noun3 = ["клиент", "клиента", "клиентов"];
