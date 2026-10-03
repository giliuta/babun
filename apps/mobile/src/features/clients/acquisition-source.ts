import {
  ACQUISITION_LABELS,
  type AcquisitionSource,
  type ClientSourceValue,
} from "@babun/shared/local/clients";

// ИСТОЧНИК КЛИЕНТА — ГОТОВЫЕ ВАРИАНТЫ ПЛЮС СВОИ У КОМАНДЫ (владелец 03.10:
// «используй источник, с учётом что они могут самостоятельно добавить
// источник»).
//
// Восемь готовых живут в коде (`ACQUISITION_LABELS`), свои — строками
// `client_sources` у команды. Клиент хранит выбор одним текстом: готовый —
// ключом, свой — `src:<id>`. Удалённый свой источник у клиента читается как
// «Другое»: значение в данных остаётся, но показать его больше нечем.
//
// Лист без React — правила проверяются тестом напрямую.

export interface ClientSource {
  id: string;
  tenant_id: string;
  team_id: string;
  name: string;
  position: number;
}

export interface SourceOption {
  value: ClientSourceValue;
  label: string;
  /** Свой источник команды — у готовых `null`. */
  sourceId: string | null;
}

const CUSTOM_PREFIX = "src:";

/** Готовые варианты в порядке выбора; «Неизвестно» — не вариант, а пустота. */
export const BUILT_IN_SOURCES: AcquisitionSource[] = [
  "referral",
  "instagram",
  "whatsapp",
  "google_maps",
  "website",
  "repeat",
  "walk_in",
  "other",
];

export function customSourceValue(id: string): ClientSourceValue {
  return `${CUSTOM_PREFIX}${id}`;
}

/** id своего источника из значения клиента; у готовых — `null`. */
export function customSourceId(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(CUSTOM_PREFIX)) return null;
  const id = value.slice(CUSTOM_PREFIX.length);
  return id ? id : null;
}

/** Свои источники команды в порядке справочника: позиция, потом имя. */
export function teamSources(sources: ClientSource[], teamId: string | null): ClientSource[] {
  return sources
    .filter((s) => s.team_id === teamId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
    );
}

/** Значение клиента для фильтра и счётчиков: пусто — «unknown», свой
 *  удалённый — «other» (как его и показывает карточка). */
export function normalizeSource(
  value: string | null | undefined,
  sources: ClientSource[],
): ClientSourceValue {
  if (!value) return "unknown";
  const id = customSourceId(value);
  if (id) return sources.some((s) => s.id === id) ? (value as ClientSourceValue) : "other";
  if (value in ACQUISITION_LABELS) return value as AcquisitionSource;
  // Незнакомый ключ (старое значение мимо перечня) — тоже «Другое».
  return "other";
}

/** Подпись источника клиента; `null` — источник не указан. */
export function sourceLabel(
  value: string | null | undefined,
  sources: ClientSource[],
): string | null {
  const v = normalizeSource(value, sources);
  if (v === "unknown") return null;
  const id = customSourceId(v);
  if (id) return sources.find((s) => s.id === id)?.name ?? ACQUISITION_LABELS.other;
  return ACQUISITION_LABELS[v as AcquisitionSource];
}

/** Варианты выбора на карточке: готовые, затем свои источники команды. */
export function sourcePickerOptions(
  sources: ClientSource[],
  teamId: string | null,
): SourceOption[] {
  return [
    ...BUILT_IN_SOURCES.map((k) => ({ value: k, label: ACQUISITION_LABELS[k], sourceId: null })),
    ...teamSources(sources, teamId).map((s) => ({
      value: customSourceValue(s.id),
      label: s.name,
      sourceId: s.id,
    })),
  ];
}

/** Варианты фильтра: готовые, свои всех команд по имени, «Неизвестно» —
 *  последним, как и было. */
export function sourceFilterOptions(
  sources: ClientSource[],
): { value: string; label: string; color: string }[] {
  const own = [...sources].sort((a, b) =>
    a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
  );
  return [
    ...BUILT_IN_SOURCES.map((k) => ({ value: k as string, label: ACQUISITION_LABELS[k], color: "" })),
    ...own.map((s) => ({ value: customSourceValue(s.id) as string, label: s.name, color: "" })),
    { value: "unknown", label: ACQUISITION_LABELS.unknown, color: "" },
  ];
}

/** Подпись строки «Источники» в шестерёнке. */
export function sourcesSummary(n: number): string {
  if (n === 0) return "Только готовые";
  const word = n % 10 === 1 && n % 100 !== 11 ? "свой" : "своих";
  return `Готовые + ${n} ${word}`;
}
