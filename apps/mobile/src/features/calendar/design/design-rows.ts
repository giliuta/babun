// Pure rows of the «Записи» page: the colour cases and the event types door.

import { COLOR_SITUATIONS, type ColorSituation } from "@/features/appointments/record-color";

export type ColorTarget = ColorSituation | "filled";

export interface DesignColorRow {
  id: ColorTarget;
  title: string;
  when: string;
  hue: string | null;
}

/** Colour cases shown for the team's blocks, the ordinary colour first. */
export function designColorRows({
  ordinary,
  objectsOn,
  paymentOn,
  palette,
}: {
  ordinary: string;
  objectsOn: boolean;
  paymentOn: boolean;
  palette: Partial<Record<ColorSituation, string | null>>;
}): DesignColorRow[] {
  // ПОДСВЕТКА — ТОЛЬКО У ВКЛЮЧЁННОГО БЛОКА (убрали объект — подсветка уходит;
  // то же с оплатой; тогда запись считается заполненной).
  const situations = COLOR_SITUATIONS.filter((s) =>
    s.id === "noObject" ? objectsOn : paymentOn,
  );
  // СТРОКИ ЦВЕТА (всё заполнено — справа выбирают цвет, или вообще без цвета). Первая — обычный цвет,
  // за ней по строке на каждый включённый блок, который подсвечивается.
  // У КАЖДОЙ СТРОКИ — КОГДА ОНА СРАБАТЫВАЕТ (человеку надо понять, что значит «всё
  // заполнено»). Не имя цвета — его говорит образец.
  const SIT_WHEN: Record<string, string> = {
    unpaid: "Визит прошёл, а оплаты нет",
    noObject: "У записи не выбран объект",
  };
  return [
    { id: "filled", title: "Обычный цвет", when: "Когда с записью всё в порядке", hue: ordinary },
    ...situations.map((sit) => ({
      id: sit.id as ColorTarget,
      title: sit.label,
      when: SIT_WHEN[sit.id] ?? "",
      hue: palette[sit.id] ?? null,
    })),
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
