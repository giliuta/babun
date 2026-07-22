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

/** New or explicitly renamed rows are the only rows an action may upsert. */
export function locationLabelUpserts(
  previous: readonly LocationLabel[],
  next: readonly LocationLabel[],
): LocationLabel[] {
  const previousById = new Map(previous.map((label) => [label.id, label.name]));
  return next.filter(
    (label) => previousById.get(label.id) !== label.name,
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
