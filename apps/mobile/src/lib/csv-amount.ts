// СУММА В CSV — ЧИСЛОМ С ДЕСЯТИЧНОЙ ЗАПЯТОЙ («-55,00»), а не строкой «−€55»:
// Excel в локали CY/RU её складывает. Жила в выгрузке для бухгалтера
// (`finances/ledger-export.ts`, удалена 03.10 по слову владельца); формат
// держит выгрузка данных из Кабинета (`cabinet/data-export.ts`).

/** «-55,00» — число с десятичной запятой: Excel в локали CY/RU считает его. */
export function csvAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  // Без кавычек: разделитель — «;», и запятая в числе ничего не ломает, а
  // в кавычках часть программ читает сумму текстом. Внутри только цифры,
  // запятая и минус — экранировать нечего.
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
