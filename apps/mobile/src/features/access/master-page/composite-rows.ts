import type { AccessBlock, AccessLevel } from "../access-map";

// СТРОКИ ЗАПИСИ, КОТОРЫЕ НЕ РАВНЫ ОДНОМУ ПРАВУ (владелец 30.09: «блоки внутри
// записи — что видит, что не видит, что может редактировать», и «продумай
// логическую цепочку»). Страница прав показывает запись блоками в порядке
// самой записи, а сервер проверяет права так, как устроены деньги и время:
//
//   • «Время» — видно всегда; менять его — то же право, что «Перенос
//     записей» в «Календаре» (`calendar.move`, с ним — «Цвет»). Одно право,
//     две строки: переключил здесь — сменилось и там.
//   • «Услуги» — «Скрыты · Только видит · Видит и меняет». Состав работ
//     меняет сумму, поэтому «Видит и меняет» — это право на суммы записи
//     (`record.amount: write`), как на странице записи сотрудника
//     (`recordBlocks`: услуги правит «Сумма и услуги: Меняет»).
//   • «Цены» — «Скрыты · Видит», под «Услугами». Кто меняет услуги, видит и
//     цены: пока «Услуги: Видит и меняет», строка стоит на «Видит» и не
//     переключается.
//
// Что закрывается вместе с чем (скрыты услуги — скрыты цены и оплата), живёт
// в `DEPENDANT_BLOCKS`: там же сворачиваются строки и сбрасываются положения.

export type LevelGet = (key: string) => AccessLevel;

export interface CompositeRow {
  /** Ключ строки — по нему слова, плитка, фраза и вид в шторке. */
  key: string;
  /** Право реестра, без которого строки нет: оно должно быть живым. */
  anchor: string;
  /** Ступени строки по порядку. */
  levels: readonly AccessLevel[];
  /** Ступень строки из прав реестра. */
  levelOf: (get: LevelGet) => AccessLevel;
  /** Какие права реестра ставит выбранная ступень (только то, что меняется). */
  changesFor: (level: AccessLevel, get: LevelGet) => Record<string, AccessLevel>;
  /** Почему строка сейчас не переключается; `null` — переключается. */
  lockedBy?: (get: LevelGet) => string | null;
}

export const WHEN_KEY = "record.when";
export const SERVICES_KEY = "record.services";
export const AMOUNT_KEY = "record.amount";
export const PAYMENT_KEY = "record.payment";
const MOVE = "calendar.move";
const COLOR = "record.color";

const ROWS: readonly CompositeRow[] = [
  {
    key: WHEN_KEY,
    anchor: MOVE,
    levels: ["read", "write"],
    levelOf: (get) => (get(MOVE) === "write" ? "write" : "read"),
    changesFor: (level): Record<string, AccessLevel> => {
      const move: AccessLevel = level === "write" ? "write" : "off";
      return { [MOVE]: move, [COLOR]: move };
    },
  },
  {
    key: SERVICES_KEY,
    anchor: SERVICES_KEY,
    levels: ["off", "read", "write"],
    levelOf: (get) => {
      if (get(SERVICES_KEY) === "off") return "off";
      return get(AMOUNT_KEY) === "write" ? "write" : "read";
    },
    changesFor: (level, get): Record<string, AccessLevel> => {
      if (level === "off") return { [SERVICES_KEY]: "off", [AMOUNT_KEY]: "off", [PAYMENT_KEY]: "off" };
      if (level === "write") return { [SERVICES_KEY]: "read", [AMOUNT_KEY]: "write" };
      // «Только видит»: правку сумм снимаем, видимость цен оставляем как была.
      return get(AMOUNT_KEY) === "write"
        ? { [SERVICES_KEY]: "read", [AMOUNT_KEY]: "read" }
        : { [SERVICES_KEY]: "read" };
    },
  },
  {
    key: AMOUNT_KEY,
    anchor: AMOUNT_KEY,
    levels: ["off", "read"],
    levelOf: (get) => (get(AMOUNT_KEY) === "off" ? "off" : "read"),
    changesFor: (level, get): Record<string, AccessLevel> => {
      if (level === "off") return { [AMOUNT_KEY]: "off", [PAYMENT_KEY]: "off" };
      return get(AMOUNT_KEY) === "off" ? { [AMOUNT_KEY]: "read" } : {};
    },
    lockedBy: (get) => (get(AMOUNT_KEY) === "write" ? "Цены видит, пока меняет услуги" : null),
  },
];

const BY_KEY = new Map(ROWS.map((row) => [row.key, row]));

export function compositeRow(key: string): CompositeRow | undefined {
  return BY_KEY.get(key);
}

/** Блоки строк страницы: у составной строки — её ступени; «Время» —
 *  строкой записи, когда «Перенос записей» живой. Реестр не меняется. */
export function withCompositeBlocks(offered: readonly AccessBlock[]): AccessBlock[] {
  const byKey = new Map(offered.map((block) => [block.key, block]));
  const out: AccessBlock[] = [];
  for (const block of offered) {
    if (block.key === WHEN_KEY) continue;
    const row = BY_KEY.get(block.key);
    out.push(row ? { ...block, levels: [...row.levels] } : block);
  }
  const move = byKey.get(MOVE);
  if (move) {
    out.push({
      ...move,
      key: WHEN_KEY,
      title: "Время",
      levels: [...(BY_KEY.get(WHEN_KEY)?.levels ?? [])],
      position: (byKey.get("record.label")?.position ?? move.position) + 0.5,
    });
  }
  return out;
}

/** Реальные изменения прав для ступени строки. Не составная строка — само
 *  право. */
export function rowChanges(key: string, level: AccessLevel, get: LevelGet): Record<string, AccessLevel> {
  const row = BY_KEY.get(key);
  return row ? row.changesFor(level, get) : { [key]: level };
}

/** Ступень строки. Не составная — положение самого права. */
export function rowLevel(key: string, get: LevelGet): AccessLevel {
  const row = BY_KEY.get(key);
  return row ? row.levelOf(get) : get(key);
}

/** Почему строка стоит и не переключается; `null` — переключается. */
export function rowLock(key: string, get: LevelGet): string | null {
  return BY_KEY.get(key)?.lockedBy?.(get) ?? null;
}

/** Право реестра, по которому решается, сворачивать ли строку. */
export function rowAnchor(key: string): string {
  return BY_KEY.get(key)?.anchor ?? key;
}
