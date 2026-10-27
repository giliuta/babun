// Pure rows of the «Записи» page: the colour cases and the event types door.
import { COLOR_SITUATIONS, type ColorSituation } from "@/features/appointments/record-color";
import type { PaletteKey } from "@/features/appointments/booking-prefs";

export type ColorTarget = PaletteKey | "filled";

export interface DesignColorRow {
  id: ColorTarget;
  title: string;
  when: string;
  /** Цвет строки; `null` — случай сейчас не красит. */
  hue: string | null;
  /** Есть выключатель: у всех, кроме обычного цвета. */
  toggles: boolean;
}

/** Colour cases shown for the team's blocks, the ordinary colour first. */
export function designColorRows({
  ordinary,
  objectsOn,
  paymentOn,
  palette,
  cancelled = null,
  paid = null,
  prepaid = null,
}: {
  ordinary: string;
  objectsOn: boolean;
  paymentOn: boolean;
  palette: Partial<Record<ColorSituation, string | null>>;
  /** Цвет отменённой; `null` — отмена не красит. */
  cancelled?: string | null;
  /** Цвет оплаченной полностью; `null` — оплата не красит. */
  paid?: string | null;
  /** Цвет записи с внесённой частью суммы до визита; `null` — не красит. */
  prepaid?: string | null;
}): DesignColorRow[] {
  // ПОДСВЕТКА — ТОЛЬКО У ВКЛЮЧЁННОГО БЛОКА: убрали объект — уходит «нет
  // объекта»; убрали оплату — уходят и долг, и «Оплачено». Кто оплату не
  // ведёт, не видит строк про неё вовсе.
  // У КАЖДОЙ СТРОКИ — КОГДА ОНА СРАБАТЫВАЕТ (человеку надо понять, что значит
  // «всё заполнено»). Не имя цвета — его говорит образец.
  const situation = (id: ColorSituation, when: string): DesignColorRow => ({
    id,
    title: COLOR_SITUATIONS.find((s) => s.id === id)?.label ?? "",
    when,
    hue: palette[id] ?? null,
    toggles: true,
  });
  // ОПЛАТА — ОДНИМ ЦВЕТОМ НА ВСЕ СПОСОБЫ: чем платили, видно в самой записи.
  const paidRow: DesignColorRow = {
    id: "paid",
    title: "Оплачено",
    when: "Оплачено полностью — картой, наличными, переводом",
    hue: paid,
    toggles: true,
  };
  return [
    { id: "filled", title: "Обычный цвет", when: "Когда с записью всё в порядке", hue: ordinary, toggles: false },
    {
      id: "cancelled",
      title: "Отменена",
      when: "Запись отменили — имя зачёркнуто",
      hue: cancelled,
      toggles: true,
    },
    ...(paymentOn
      ? [
          situation("unpaid", "Визит прошёл, а оплаты нет"),
          paidRow,
          {
            id: "prepaid",
            title: "Предоплата",
            when: "Визит впереди, внесена часть суммы",
            hue: prepaid,
            toggles: true,
          } satisfies DesignColorRow,
        ]
      : []),
    ...(objectsOn ? [situation("noObject", "У записи не выбран объект")] : []),
  ];
}

// Подпись двери — имена типов, как у «Меток»; пока грузится — пусто.
export function eventTypesSubtitle(
  loading: boolean,
  types: readonly { label: string; hidden?: boolean | null }[],
): string | undefined {
  const liveTypes = types.filter((type) => !type.hidden);
  return loading
    ? undefined
    : liveTypes.length === 0
      ? "Типов пока нет"
      : liveTypes.map((type) => type.label).join(", ");
}
