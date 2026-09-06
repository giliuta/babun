// КАКОГО ЦВЕТА ЭТА ЗАПИСЬ — ОДНО ПРАВИЛО НА ПРОДУКТ.
//
// Владелец 2026-09-05: «хочу, чтоб в настройках была цветовая палитра: если
// нет клиента — тогда цвет такой-то, тапаю, могу выбрать любой; если нет
// объекта — тогда цвет такой-то… чтобы человек один раз настроил, и всё».
//
// Цвет записи перестал быть украшением: он ОТВЕЧАЕТ НА ВОПРОС «чего этой
// работе не хватает». В календаре день читается одним взглядом — вот эти
// три блока серые, значит в них не выбраны услуги, и до выезда их надо
// дозаполнить; остальные в цвете команды, значит с ними всё в порядке.
//
// ПОРЯДОК ЖЁСТКИЙ, И ОН ЖЕ ПОРЯДОК ВАЖНОСТИ: сперва рука человека (выбранный
// цвет — это его решение, спорить с ним нельзя), потом первая незакрытая
// дыра сверху вниз, и только потом «обычный» цвет — команды или метки, как
// настроено. Ситуация без своего цвета пропускается: выключить сигнал должно
// быть так же просто, как включить.
//
// Ситуации проверяются ТОЛЬКО те, что вообще есть у этого бизнеса: у мастера
// маникюра блок объекта выключен (Кабинет → «Запись»), и «нет объекта» для
// него не дыра, а норма.

export type ColorSituation = "noClient" | "noObject" | "noServices";

export interface ColorSituationDef {
  id: ColorSituation;
  label: string;
}

/** Порядок здесь и есть порядок разрешения конфликтов.
 *
 *  ПОДПИСИ У СИТУАЦИИ НЕТ. Здесь лежало поле `hint` («не сказано, кому едем»),
 *  которое до экрана не доехало ни разу: строка настройки показывает ИМЯ
 *  ЦВЕТА — то, чего не видно на бледном образце, — а сама ситуация названа
 *  заголовком и объяснять себя другими словами не нуждается. */
export const COLOR_SITUATIONS: ColorSituationDef[] = [
  { id: "noClient", label: "Нет клиента" },
  { id: "noObject", label: "Нет объекта" },
  { id: "noServices", label: "Нет услуг" },
];

/** ЧТО СЧИТАЕТСЯ ЗАПОЛНЕННЫМ — ОДНО МЕСТО НА ПРОДУКТ. Сетка и форма собирали
 *  это по отдельности, а закон говорит: один выезд выглядит одинаково там, где
 *  его заводят, и там, где на него смотрят.
 *
 *  Правила шире, чем «есть ссылка»:
 *  — ОБЪЕКТ закрыт и вписанным адресом: разовый выезд по звонку в справочник
 *    не заводят, и красить его дырой значит врать;
 *  — УСЛУГИ закрыты снимком строк или вписанной рукой суммой: по базе работ
 *    без каталожной услуги 9 из 27, а сумма вписана рукой в 20 записях из 30 —
 *    без этого треть книги загорелась бы «дырой» на готовых записях. */
export function recordFilled(apt: {
  client_id?: string | null;
  location_id?: string | null;
  address?: string | null;
  service_ids?: unknown[] | null;
  services?: unknown[] | null;
  custom_total?: boolean | null;
  total_amount?: number | string | null;
}): { client: boolean; object: boolean; services: boolean } {
  return {
    client: !!apt.client_id,
    object:
      !!apt.location_id || (apt.address ?? "").trim().length >= 3,
    services:
      (apt.service_ids?.length ?? 0) > 0 ||
      (apt.services?.length ?? 0) > 0 ||
      !!apt.custom_total ||
      Number(apt.total_amount ?? 0) > 0,
  };
}

/** ЦВЕТ ЗАПИСИ ПО УСЛУГЕ — ПЕРВАЯ СТРОКА, У КОТОРОЙ ЦВЕТ ЕЩЁ ЕСТЬ.
 *
 *  Порядок услуг — это порядок нажатий (выбор дописывает в конец) и он же
 *  порядок, в котором услуги напечатаны третьей строкой блока. Значит на
 *  вопрос «почему эта запись зелёная» отвечает сам блок, без открытия записи.
 *  Ни цена строки, ни её длительность на календаре не напечатаны нигде —
 *  правило, которое нельзя сверить глазом, диспетчер перестаёт считать
 *  правилом.
 *
 *  СНИМОК `services[]` ЦВЕТА НЕ ХРАНИТ, и читается он ВТОРЫМ: бригадная
 *  проекция отдаёт `services: []` при заполненном `service_ids`, и снимок
 *  первым источником молча гасил бы цвет в наряде мастера.
 *
 *  Строка со стёртой насовсем услугой ПРОПУСКАЕТСЯ к следующей: имя такой
 *  услуги живёт в снимке и печатается, а цвета у неё нет — падать из-за неё в
 *  цвет команды значило бы «правило не работает» на большинстве записей. */
export function serviceBaseColor(
  apt: {
    service_ids?: readonly string[] | null;
    services?: readonly { serviceId: string }[] | null;
  },
  colorOf: (id: string) => string | null | undefined,
): string | null {
  const ids = apt.service_ids?.length
    ? apt.service_ids
    : (apt.services ?? []).map((line) => line.serviceId);
  for (const id of ids) {
    const color = (colorOf(id) ?? "").trim();
    if (color) return color;
  }
  return null;
}

export interface RecordColorInput {
  /** Цвет, выбранный руками у этой записи. Сильнее любого правила. */
  override?: string | null;
  /** Что в записи заполнено. */
  filled: { client: boolean; object: boolean; services: boolean };
  /** Цвет «обычной» записи: команды или метки — по настройке. */
  base?: string | null;
  /** Настроенные цвета ситуаций; `null` — ситуация не красит. */
  palette: Partial<Record<ColorSituation, string | null>>;
  /** Ситуации, которые проверяем. Не задано — все. */
  active?: readonly ColorSituation[];
  /** Когда не сказало ничто: кобальт продукта. */
  fallback: string;
}

/** Какая именно дыра красит запись — чтобы назвать её СЛОВОМ там, где есть
 *  место (лента, озвучка). Цвет один на три ситуации различает их слишком
 *  слабо для дальтоника: ΔE заливок «нет объекта» и «нет услуг» при
 *  дейтеранопии — 4.1, и никакой оттенок этого не закроет. */
export function resolveRecordSituation(
  input: Pick<RecordColorInput, "override" | "filled" | "palette" | "active">,
): ColorSituation | null {
  if ((input.override ?? "").trim()) return null;
  const active = input.active ?? COLOR_SITUATIONS.map((s) => s.id);
  const missing: Record<ColorSituation, boolean> = {
    noClient: !input.filled.client,
    noObject: !input.filled.object,
    noServices: !input.filled.services,
  };
  for (const def of COLOR_SITUATIONS) {
    if (!active.includes(def.id)) continue;
    if (!missing[def.id]) continue;
    if ((input.palette[def.id] ?? "").trim()) return def.id;
  }
  return null;
}

export function resolveRecordColor(input: RecordColorInput): string {
  const own = (input.override ?? "").trim();
  if (own) return own;

  const active = input.active ?? COLOR_SITUATIONS.map((s) => s.id);
  const missing: Record<ColorSituation, boolean> = {
    noClient: !input.filled.client,
    noObject: !input.filled.object,
    noServices: !input.filled.services,
  };
  for (const def of COLOR_SITUATIONS) {
    if (!active.includes(def.id)) continue;
    if (!missing[def.id]) continue;
    const color = (input.palette[def.id] ?? "").trim();
    if (color) return color;
  }

  const base = (input.base ?? "").trim();
  return base || input.fallback;
}
