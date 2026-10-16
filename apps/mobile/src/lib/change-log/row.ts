// Change-log row shape and the noun of its subject (word + gender). No React,
// like the entry.

export interface ChangeLogRow {
  id: number;
  team_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  entity: string;
  entity_id: string | null;
  action: "insert" | "update" | "delete" | "restore";
  label: string | null;
  meta: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

type Gender = "m" | "f" | "n" | "pl";

interface Noun {
  word: string;
  gender: Gender;
}

export const PARTICIPLES: Record<ChangeLogRow["action"], Record<Gender, string>> = {
  insert: { m: "создан", f: "создана", n: "создано", pl: "созданы" },
  update: { m: "изменён", f: "изменена", n: "изменено", pl: "изменены" },
  delete: { m: "удалён", f: "удалена", n: "удалено", pl: "удалены" },
  restore: { m: "возвращён", f: "возвращена", n: "возвращено", pl: "возвращены" },
};

const NOUNS: Record<string, Noun> = {
  clients: { word: "Клиент", gender: "m" },
  debts: { word: "Долг", gender: "m" },
  receipts: { word: "Чек", gender: "m" },
  teams: { word: "Календарь", gender: "m" },
  accounts: { word: "Счёт", gender: "m" },
  services: { word: "Услуга", gender: "f" },
  cities: { word: "Метка", gender: "f" },
  client_tags: { word: "Тег", gender: "m" },
  client_sources: { word: "Источник", gender: "m" },
  location_labels: { word: "Тип объекта", gender: "m" },
  finance_categories: { word: "Категория", gender: "f" },
  personal_event_types: { word: "Тип события", gender: "m" },
  team_design: { word: "Настройки записей", gender: "pl" },
  team_schedules: { word: "График", gender: "m" },
  day_cities: { word: "Метка дня", gender: "f" },
  calendar_settings: { word: "Настройки календаря", gender: "pl" },
  legal_entities: { word: "Реквизиты", gender: "pl" },
  sms_team_templates: { word: "Шаблон SMS", gender: "m" },
  masters: { word: "Карточка партнёра", gender: "f" },
};

const TX_NOUNS: Record<string, Noun> = {
  income: { word: "Доход", gender: "m" },
  expense: { word: "Расход", gender: "m" },
  transfer: { word: "Перевод", gender: "m" },
  refund: { word: "Возврат", gender: "m" },
};

/** Что за предмет: «Запись», «Событие», «Доход», «Кредит-нота»… */
export function entityNoun(row: Pick<ChangeLogRow, "entity" | "meta">): Noun {
  const meta = row.meta ?? {};
  if (row.entity === "appointments") {
    return meta.kind === "event" ? { word: "Событие", gender: "n" } : { word: "Запись", gender: "f" };
  }
  if (row.entity === "finance_transactions") {
    return TX_NOUNS[String(meta.type)] ?? { word: "Операция", gender: "f" };
  }
  if (row.entity === "invoices") {
    return meta.kind === "credit_note" ? { word: "Кредит-нота", gender: "f" } : { word: "Инвойс", gender: "m" };
  }
  return NOUNS[row.entity] ?? { word: "Данные", gender: "pl" };
}
