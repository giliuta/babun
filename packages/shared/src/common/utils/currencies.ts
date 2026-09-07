// ВСЕ ВАЛЮТЫ ISO 4217 (владелец 2026-09-06: «добавь все виды валют, сверху
// поиск, слева название, справа значок и код»). Имена по-русски — так их ищут;
// символ — тот, что пишут перед суммой, а где своего нет, стоит код.
// Порядок здесь алфавитный по коду; порядок ПОКАЗА задаёт `currencyWheelOrder`.

export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
}

export const ALL_CURRENCIES: readonly CurrencyDef[] = [
  { code: "AED", name: "Дирхам ОАЭ", symbol: "د.إ" },
  { code: "AFN", name: "Афгани", symbol: "؋" },
  { code: "ALL", name: "Албанский лек", symbol: "L" },
  { code: "AMD", name: "Армянский драм", symbol: "֏" },
  { code: "ANG", name: "Антильский гульден", symbol: "ƒ" },
  { code: "AOA", name: "Ангольская кванза", symbol: "Kz" },
  { code: "ARS", name: "Аргентинское песо", symbol: "$" },
  { code: "AUD", name: "Австралийский доллар", symbol: "A$" },
  { code: "AWG", name: "Арубанский флорин", symbol: "ƒ" },
  { code: "AZN", name: "Азербайджанский манат", symbol: "₼" },
  { code: "BAM", name: "Конвертируемая марка", symbol: "KM" },
  { code: "BBD", name: "Барбадосский доллар", symbol: "$" },
  { code: "BDT", name: "Бангладешская така", symbol: "৳" },
  { code: "BGN", name: "Болгарский лев", symbol: "лв" },
  { code: "BHD", name: "Бахрейнский динар", symbol: "BD" },
  { code: "BIF", name: "Бурундийский франк", symbol: "FBu" },
  { code: "BMD", name: "Бермудский доллар", symbol: "$" },
  { code: "BND", name: "Брунейский доллар", symbol: "$" },
  { code: "BOB", name: "Боливиано", symbol: "Bs" },
  { code: "BRL", name: "Бразильский реал", symbol: "R$" },
  { code: "BSD", name: "Багамский доллар", symbol: "$" },
  { code: "BTN", name: "Нгултрум", symbol: "Nu." },
  { code: "BWP", name: "Ботсванская пула", symbol: "P" },
  { code: "BYN", name: "Белорусский рубль", symbol: "Br" },
  { code: "BZD", name: "Белизский доллар", symbol: "BZ$" },
  { code: "CAD", name: "Канадский доллар", symbol: "C$" },
  { code: "CDF", name: "Конголезский франк", symbol: "FC" },
  { code: "CHF", name: "Швейцарский франк", symbol: "CHF" },
  { code: "CLP", name: "Чилийское песо", symbol: "$" },
  { code: "CNY", name: "Китайский юань", symbol: "¥" },
  { code: "COP", name: "Колумбийское песо", symbol: "$" },
  { code: "CRC", name: "Костариканский колон", symbol: "₡" },
  { code: "CUP", name: "Кубинское песо", symbol: "$" },
  { code: "CVE", name: "Эскудо Кабо-Верде", symbol: "$" },
  { code: "CZK", name: "Чешская крона", symbol: "Kč" },
  { code: "DJF", name: "Франк Джибути", symbol: "Fdj" },
  { code: "DKK", name: "Датская крона", symbol: "kr" },
  { code: "DOP", name: "Доминиканское песо", symbol: "RD$" },
  { code: "DZD", name: "Алжирский динар", symbol: "DA" },
  { code: "EGP", name: "Египетский фунт", symbol: "E£" },
  { code: "ERN", name: "Накфа", symbol: "Nfk" },
  { code: "ETB", name: "Эфиопский быр", symbol: "Br" },
  { code: "EUR", name: "Евро", symbol: "€" },
  { code: "FJD", name: "Доллар Фиджи", symbol: "FJ$" },
  { code: "FKP", name: "Фунт Фолклендских островов", symbol: "£" },
  { code: "GBP", name: "Фунт стерлингов", symbol: "£" },
  { code: "GEL", name: "Грузинский лари", symbol: "₾" },
  { code: "GHS", name: "Ганский седи", symbol: "₵" },
  { code: "GIP", name: "Гибралтарский фунт", symbol: "£" },
  { code: "GMD", name: "Даласи", symbol: "D" },
  { code: "GNF", name: "Гвинейский франк", symbol: "FG" },
  { code: "GTQ", name: "Кетсаль", symbol: "Q" },
  { code: "GYD", name: "Гайанский доллар", symbol: "G$" },
  { code: "HKD", name: "Гонконгский доллар", symbol: "HK$" },
  { code: "HNL", name: "Лемпира", symbol: "L" },
  { code: "HTG", name: "Гурд", symbol: "G" },
  { code: "HUF", name: "Венгерский форинт", symbol: "Ft" },
  { code: "IDR", name: "Индонезийская рупия", symbol: "Rp" },
  { code: "ILS", name: "Новый израильский шекель", symbol: "₪" },
  { code: "INR", name: "Индийская рупия", symbol: "₹" },
  { code: "IQD", name: "Иракский динар", symbol: "IQD" },
  { code: "IRR", name: "Иранский риал", symbol: "IRR" },
  { code: "ISK", name: "Исландская крона", symbol: "kr" },
  { code: "JMD", name: "Ямайский доллар", symbol: "J$" },
  { code: "JOD", name: "Иорданский динар", symbol: "JOD" },
  { code: "JPY", name: "Японская иена", symbol: "¥" },
  { code: "KES", name: "Кенийский шиллинг", symbol: "KSh" },
  { code: "KGS", name: "Киргизский сом", symbol: "сом" },
  { code: "KHR", name: "Риель", symbol: "៛" },
  { code: "KMF", name: "Франк Комор", symbol: "CF" },
  { code: "KPW", name: "Северокорейская вона", symbol: "₩" },
  { code: "KRW", name: "Южнокорейская вона", symbol: "₩" },
  { code: "KWD", name: "Кувейтский динар", symbol: "KD" },
  { code: "KYD", name: "Доллар Каймановых островов", symbol: "CI$" },
  { code: "KZT", name: "Тенге", symbol: "₸" },
  { code: "LAK", name: "Кип", symbol: "₭" },
  { code: "LBP", name: "Ливанский фунт", symbol: "L£" },
  { code: "LKR", name: "Шри-ланкийская рупия", symbol: "Rs" },
  { code: "LRD", name: "Либерийский доллар", symbol: "L$" },
  { code: "LSL", name: "Лоти", symbol: "L" },
  { code: "LYD", name: "Ливийский динар", symbol: "LD" },
  { code: "MAD", name: "Марокканский дирхам", symbol: "MAD" },
  { code: "MDL", name: "Молдавский лей", symbol: "L" },
  { code: "MGA", name: "Малагасийский ариари", symbol: "Ar" },
  { code: "MKD", name: "Македонский денар", symbol: "ден" },
  { code: "MMK", name: "Кьят", symbol: "K" },
  { code: "MNT", name: "Тугрик", symbol: "₮" },
  { code: "MOP", name: "Патака", symbol: "MOP$" },
  { code: "MRU", name: "Угия", symbol: "UM" },
  { code: "MUR", name: "Маврикийская рупия", symbol: "Rs" },
  { code: "MVR", name: "Мальдивская руфия", symbol: "Rf" },
  { code: "MWK", name: "Малавийская квача", symbol: "MK" },
  { code: "MXN", name: "Мексиканское песо", symbol: "MX$" },
  { code: "MYR", name: "Малайзийский ринггит", symbol: "RM" },
  { code: "MZN", name: "Мозамбикский метикал", symbol: "MT" },
  { code: "NAD", name: "Доллар Намибии", symbol: "N$" },
  { code: "NGN", name: "Найра", symbol: "₦" },
  { code: "NIO", name: "Кордоба", symbol: "C$" },
  { code: "NOK", name: "Норвежская крона", symbol: "kr" },
  { code: "NPR", name: "Непальская рупия", symbol: "Rs" },
  { code: "NZD", name: "Новозеландский доллар", symbol: "NZ$" },
  { code: "OMR", name: "Оманский риал", symbol: "OMR" },
  { code: "PAB", name: "Бальбоа", symbol: "B/." },
  { code: "PEN", name: "Перуанский соль", symbol: "S/" },
  { code: "PGK", name: "Кина", symbol: "K" },
  { code: "PHP", name: "Филиппинское песо", symbol: "₱" },
  { code: "PKR", name: "Пакистанская рупия", symbol: "Rs" },
  { code: "PLN", name: "Польский злотый", symbol: "zł" },
  { code: "PYG", name: "Гуарани", symbol: "₲" },
  { code: "QAR", name: "Катарский риал", symbol: "QR" },
  { code: "RON", name: "Румынский лей", symbol: "lei" },
  { code: "RSD", name: "Сербский динар", symbol: "дин" },
  { code: "RUB", name: "Российский рубль", symbol: "₽" },
  { code: "RWF", name: "Франк Руанды", symbol: "FRw" },
  { code: "SAR", name: "Саудовский риял", symbol: "SR" },
  { code: "SBD", name: "Доллар Соломоновых островов", symbol: "SI$" },
  { code: "SCR", name: "Сейшельская рупия", symbol: "SRe" },
  { code: "SDG", name: "Суданский фунт", symbol: "SDG" },
  { code: "SEK", name: "Шведская крона", symbol: "kr" },
  { code: "SGD", name: "Сингапурский доллар", symbol: "S$" },
  { code: "SHP", name: "Фунт Святой Елены", symbol: "£" },
  { code: "SLE", name: "Леоне", symbol: "Le" },
  { code: "SOS", name: "Сомалийский шиллинг", symbol: "Sh" },
  { code: "SRD", name: "Суринамский доллар", symbol: "$" },
  { code: "SSP", name: "Южносуданский фунт", symbol: "SSP" },
  { code: "STN", name: "Добра", symbol: "Db" },
  { code: "SVC", name: "Сальвадорский колон", symbol: "₡" },
  { code: "SYP", name: "Сирийский фунт", symbol: "S£" },
  { code: "SZL", name: "Лилангени", symbol: "E" },
  { code: "THB", name: "Тайский бат", symbol: "฿" },
  { code: "TJS", name: "Сомони", symbol: "SM" },
  { code: "TMT", name: "Туркменский манат", symbol: "m" },
  { code: "TND", name: "Тунисский динар", symbol: "DT" },
  { code: "TOP", name: "Паанга", symbol: "T$" },
  { code: "TRY", name: "Турецкая лира", symbol: "₺" },
  { code: "TTD", name: "Доллар Тринидада и Тобаго", symbol: "TT$" },
  { code: "TWD", name: "Новый тайваньский доллар", symbol: "NT$" },
  { code: "TZS", name: "Танзанийский шиллинг", symbol: "TSh" },
  { code: "UAH", name: "Гривна", symbol: "₴" },
  { code: "UGX", name: "Угандийский шиллинг", symbol: "USh" },
  { code: "USD", name: "Доллар США", symbol: "$" },
  { code: "UYU", name: "Уругвайское песо", symbol: "$U" },
  { code: "UZS", name: "Узбекский сум", symbol: "сум" },
  { code: "VES", name: "Венесуэльский боливар", symbol: "Bs." },
  { code: "VND", name: "Донг", symbol: "₫" },
  { code: "VUV", name: "Вату", symbol: "VT" },
  { code: "WST", name: "Тала", symbol: "WS$" },
  { code: "XAF", name: "Франк КФА BEAC", symbol: "FCFA" },
  { code: "XCD", name: "Восточно-карибский доллар", symbol: "EC$" },
  { code: "XOF", name: "Франк КФА BCEAO", symbol: "CFA" },
  { code: "XPF", name: "Франк КФП", symbol: "₣" },
  { code: "YER", name: "Йеменский риал", symbol: "YER" },
  { code: "ZAR", name: "Южноафриканский рэнд", symbol: "R" },
  { code: "ZMW", name: "Замбийская квача", symbol: "ZK" },
  { code: "ZWL", name: "Доллар Зимбабве", symbol: "Z$" },
];

const BY_CODE: ReadonlyMap<string, CurrencyDef> = new Map(
  ALL_CURRENCIES.map((c) => [c.code, c]),
);

export function currencyDef(code: string | null | undefined): CurrencyDef | undefined {
  return BY_CODE.get((code ?? "").trim().toUpperCase());
}

/** Ходовые — в голове барабана, остальные по алфавиту имени: свою валюту
 *  ищут поиском, а первые строки должны быть теми, что выбирают чаще всего. */
export const POPULAR_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "UAH", "RUB", "TRY", "AED", "ILS"] as const;

export function currencyWheelOrder(): CurrencyDef[] {
  const head = POPULAR_CURRENCIES.map((code) => BY_CODE.get(code)).filter(
    (c): c is CurrencyDef => Boolean(c),
  );
  const rest = ALL_CURRENCIES.filter((c) => !POPULAR_CURRENCIES.includes(c.code as never)).sort(
    (a, b) => a.name.localeCompare(b.name, "ru"),
  );
  return [...head, ...rest];
}

/** Поиск по имени, коду и символу. Ранг: имя или код с начала, либо символ
 *  целиком → слово имени с начала → просто вхождение; внутри ранга — порядок
 *  словаря. На «доллар» первым выходит «Доллар США», а не «Австралийский
 *  доллар». */
export function searchCurrencies(query: string, limit = 40): CurrencyDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Внутри ранга ходовые впереди: на «дол» первым нужен «Доллар США», а не
  // «Доллар Фиджи», который стоит раньше по коду.
  const popularity = (code: string) => {
    const i = POPULAR_CURRENCIES.indexOf(code as never);
    return i < 0 ? POPULAR_CURRENCIES.length : i;
  };
  const ranked: { c: CurrencyDef; rank: number }[] = [];
  for (const c of ALL_CURRENCIES) {
    const name = c.name.toLowerCase();
    const code = c.code.toLowerCase();
    const symbol = c.symbol.toLowerCase();
    let rank = -1;
    if (name.startsWith(q) || code.startsWith(q) || symbol === q) rank = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) rank = 1;
    else if (name.includes(q) || code.includes(q) || symbol.includes(q)) rank = 2;
    if (rank >= 0) ranked.push({ c, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || popularity(a.c.code) - popularity(b.c.code))
    .slice(0, limit)
    .map((x) => x.c);
}
