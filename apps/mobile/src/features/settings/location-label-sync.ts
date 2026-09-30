import type { LocationLabel } from "@babun/shared/local/location-labels";

/**
 * Only labels the user actually removed from the snapshot they saw may be
 * archived. A label created concurrently on another device is absent from
 * both arrays and therefore never appears in this list.
 */
export function locationLabelRemoveIds(
  previous: readonly LocationLabel[],
  next: readonly LocationLabel[],
): string[] {
  const nextIds = new Set(next.map((label) => label.id));
  return previous
    .filter((label) => !nextIds.has(label.id))
    .map((label) => label.id);
}

/** Что именно сравнивается, когда решаем «строка изменилась». ИМЯ И ВИД: с
 *  2026-09-10 у типа объекта есть цвет и значок, и сравнение по одному имени
 *  молча теряло их — правка вида уходила в ноль строк на запись, лист
 *  закрывался «успешно», а в базе оставалось пусто. */
function labelFingerprint(label: LocationLabel): string {
  return [label.name, label.color ?? "", label.icon ?? ""].join("\u0000");
}

/** New rows and rows whose name or look changed are the only rows an action
 *  may upsert. */
export function locationLabelUpserts(
  previous: readonly LocationLabel[],
  next: readonly LocationLabel[],
): LocationLabel[] {
  const previousById = new Map(
    previous.map((label) => [label.id, labelFingerprint(label)]),
  );
  return next.filter(
    (label) => previousById.get(label.id) !== labelFingerprint(label),
  );
}

export interface PositionedLocationLabel extends LocationLabel {
  position: number;
}

export function positionedLocationLabelUpserts(
  previous: readonly LocationLabel[],
  next: readonly LocationLabel[],
): PositionedLocationLabel[] {
  const positionById = new Map(
    next.map((label, position) => [label.id, position]),
  );
  return locationLabelUpserts(previous, next).map((label) => ({
    ...label,
    position: positionById.get(label.id) ?? 0,
  }));
}
