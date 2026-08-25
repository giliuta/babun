// STORY-002: quick-pick пресеты услуг для BookingSheet.
// Не заменяют модель Service (которая остаётся полноценной с
// категориями, материалами и прайсом), а ускоряют выбор в форме
// записи. На создании записи preset → либо матчится с Service из
// БД услуг по id, либо записывается как inline-услуга.

export interface ServicePreset {
  id: string;
  label: string;
  units: number;      // количество сплит-блоков (0 для выезда)
  duration: number;   // минуты
  /** Фиксированная цена (используется когда units = 0). */
  fixedPrice?: number;
}

export const SERVICE_PRESETS: ServicePreset[] = [
  { id: "svc-clean-1", label: "Чистка 1 блока",  units: 1, duration: 45  },
  { id: "svc-clean-2", label: "Чистка 2 блоков", units: 2, duration: 75  },
  { id: "svc-clean-3", label: "Чистка 3 блоков", units: 3, duration: 105 },
  { id: "svc-clean-4", label: "Чистка 4 блоков", units: 4, duration: 140 },
  { id: "svc-visit",   label: "Выезд / осмотр",  units: 0, duration: 30, fixedPrice: 0  },
  { id: "svc-outdoor", label: "Внешний блок",    units: 0, duration: 30, fixedPrice: 30 },
];

// Цена за чистку зависит от объёма: 3+ блоков — скидка, 1-2 блока
// по базовой цене. Согласовано с владельцем AirFix.
export function priceForUnits(n: number): number {
  if (n <= 0) return 0;
  return n >= 3 ? n * 45 : n * 50;
}

export function priceForPreset(preset: ServicePreset): number {
  if (preset.fixedPrice !== undefined) return preset.fixedPrice;
  return priceForUnits(preset.units);
}

// Smart-suggestion: по количеству блоков на объекте подобрать
// наиболее подходящий пресет чистки. Если блоков 0 — ничего.
// Если >4 — тянем на пресет 4 (бригадир поправит вручную).
export function suggestPreset(acUnits: number): ServicePreset | null {
  if (acUnits <= 0) return null;
  const clamped = Math.min(acUnits, 4);
  return (
    SERVICE_PRESETS.find(
      (p) => p.units === clamped && p.label.startsWith("Чистка")
    ) ?? null
  );
}
