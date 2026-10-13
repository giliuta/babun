import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  periodLabel,
  propertyTypeLabel,
  SEGMENT_OPTIONS,
  type ActiveToken,
  type ClientsFilter,
  type FacetOption,
} from "../filter";

// Removable tokens of the summary bar, one per active filter value.

interface TokenOptions {
  teamOptions: FacetOption[];
  cityOptions: FacetOption[];
  tagOptions: FacetOption[];
  sourceOptions: FacetOption[];
}

export function activeFilterTokens(
  filter: ClientsFilter,
  { teamOptions, cityOptions, tagOptions, sourceOptions }: TokenOptions,
): ActiveToken[] {
  const {
    segments,
    selectedTeams,
    selectedCities,
    activeTags,
    period,
    sources,
    propertyTypes,
  } = filter;
  const tokens: ActiveToken[] = [];
  for (const seg of segments) {
    const o = SEGMENT_OPTIONS.find((x) => x.key === seg);
    if (o)
      tokens.push({ key: "segment", val: seg, label: o.label, color: "" });
  }
  const teamLabel = new Map(teamOptions.map((o) => [o.value, o]));
  for (const id of selectedTeams) {
    const o = teamLabel.get(id);
    if (o)
      tokens.push({ key: "team", val: id, label: o.label, color: o.color });
  }
  const cityColor = new Map(cityOptions.map((o) => [o.value, o.color]));
  for (const city of selectedCities) {
    tokens.push({
      key: "city",
      val: city,
      label: city,
      // Цвет метки из библиотеки (как в календаре); legacy — avatar-цвет.
      color: cityColor.get(city) ?? getAvatarColor(city),
    });
  }
  const tagLabel = new Map(tagOptions.map((o) => [o.value, o]));
  for (const id of activeTags) {
    const o = tagLabel.get(id);
    if (o)
      tokens.push({ key: "tag", val: id, label: o.label, color: o.color });
  }
  if (period) {
    tokens.push({
      key: "period",
      val: period.preset,
      label: periodLabel(period),
      color: "",
    });
  }
  for (const src of sources) {
    const o = sourceOptions.find((x) => x.value === src);
    if (o)
      tokens.push({ key: "source", val: src, label: o.label, color: "" });
  }
  for (const p of propertyTypes) {
    // Метка бизнеса печатается как есть; раньше токен молча исчезал, если
    // значения не было в зашитом перечислении.
    tokens.push({
      key: "property",
      val: p,
      label: propertyTypeLabel(p),
      color: "",
    });
  }
  return tokens;
}
