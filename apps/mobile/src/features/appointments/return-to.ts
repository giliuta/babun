// ДОРОГА НАЗАД ИЗ ЗАПИСИ — ОДИН СЛОВАРЬ НА ВЕСЬ ПРОДУКТ.
//
// Запись открывают с четырёх поверхностей: календарь (своя, дороги не нужно),
// вкладка денег, страница инвойса, карточка счёта. Три последние передают
// `from`, и «назад» обязано вернуть человека туда, откуда он пришёл.
//
// Почему словарь переехал сюда (2026-09-08): он жил внутри календаря, а
// страница записи `/book` про `from` не знала вовсе — её `leaveBook()` звал
// слепой `router.back()`. Стек при заходе из денег — «финансы → календарь →
// запись», поэтому владелец нажимал доход, закрывал запись и оказывался на
// календаре, да ещё и переключённом на «День». Возврат работал только у
// бригадира: ему открывается лист поверх календаря, а не страница.
//
// Формат `from`: «finances» — вкладка денег; «invoice:<id>» и «account:<id>» —
// страница-донор, с чьей проводки запись открыли.

export function resolveReturnTo(from: string | undefined): string | null {
  if (!from) return null;
  if (from === "finances") return "/finances";
  const donor = (prefix: string, base: string) => {
    if (!from.startsWith(prefix)) return null;
    const id = from.slice(prefix.length).trim();
    // Пустой id дал бы `/invoices/` — маршрут, которого нет. Лучше остаться на
    // календаре, чем увести человека на «страница не найдена».
    return id ? `${base}/${id}` : null;
  };
  return donor("invoice:", "/invoices") ?? donor("account:", "/accounts");
}

/** Метка для ссылки: `from=` собирается только там, где дорога есть. */
export function returnToParam(from: string | undefined): string {
  return from ? `&from=${encodeURIComponent(from)}` : "";
}
