import { useState } from "react";
import { View } from "react-native";
import { Eye } from "lucide-react-native";

import { NavRow } from "@/components/ui/card-rows";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { SectionCard } from "@/components/ui/SectionCard";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { CALENDAR_GROUPS, CALENDAR_GROUP_TITLE, type CalendarGroup } from "./access-summary";

// БЛОК «ДОСТУП» — ВСЕ ПРАВА ЧЕЛОВЕКА ОДНИМ БЛОКОМ (этап 1 плана 29.09;
// владелец: «набор прав, календари, права в компании — это всё надо
// объединить в один блок»; следом: «Мастер · Старший · Директор уберём…
// захожу на страницу календарь — там всё выбираю, на запись — там всё»).
// Сверху вниз:
//   «Календари» — к каким он прикреплён, тап — выбор;
//   плашки календарей, если их больше одного: строки ниже — про выбранный;
//   «Календарь · Запись · Финансы» — права в выбранном календаре, каждая
//   строка открывает страницу только своего раздела;
//   «Клиенты · Компания» — права на всю компанию;
//   «Посмотреть его глазами».

export interface CompanyRightsRow {
  key: string;
  label: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
}

export interface EmployeeAccessCardProps {
  /** Календари, к которым человек прикреплён, в его порядке. */
  calendars: readonly Team[];
  /** Выбор календарей. Нет — строка только показывает. */
  onOpenCalendars?: () => void;
  groupLine: (teamId: string, group: CalendarGroup) => string;
  onOpenCalendarRights?: (teamId: string, group: CalendarGroup) => void;
  companyRows: readonly CompanyRightsRow[];
  onMirror?: () => void;
}

export function EmployeeAccessCard(p: EmployeeAccessCardProps) {
  const t = useThemeColors();
  const [picked, setPicked] = useState<string | null>(null);
  const active =
    p.calendars.find((team) => team.id === picked)?.id ?? p.calendars[0]?.id ?? null;
  const groups = active
    ? CALENDAR_GROUPS.map((group) => ({ group, line: p.groupLine(active, group) })).filter(
        (row) => row.line !== "",
      )
    : [];
  const openRights = (group: CalendarGroup) =>
    active && p.onOpenCalendarRights ? () => p.onOpenCalendarRights!(active, group) : undefined;
  let separated = false;
  const nextSeparated = () => {
    const was = separated;
    separated = true;
    return was;
  };

  return (
    <SectionCard title="Доступ" padded={false}>
      <NavRow
        separated={nextSeparated()}
        label="Календари"
        value={p.calendars.map((team) => team.name).join(", ") || null}
        placeholder="нет"
        onPress={p.onOpenCalendars}
      />

      {p.calendars.length > 1 && active ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
          <ScopeChips
            items={p.calendars.map((team) => ({ id: team.id, name: team.name, color: team.color }))}
            activeId={active}
            seam={false}
            onSelect={setPicked}
          />
        </View>
      ) : null}

      {groups.map((row) => (
        <NavRow
          key={row.group}
          separated={nextSeparated()}
          label={CALENDAR_GROUP_TITLE[row.group]}
          value={row.line}
          valueColor={row.line === "Не видит" ? t.faint : undefined}
          onPress={openRights(row.group)}
        />
      ))}

      {p.companyRows.map((row) => (
        <NavRow
          key={row.key}
          separated={nextSeparated()}
          label={row.label}
          value={row.value}
          valueColor={row.valueColor}
          onPress={row.onPress}
        />
      ))}

      {p.onMirror ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
          <ChooseRow compact icon={Eye} label="Посмотреть его глазами" onPress={p.onMirror} />
        </View>
      ) : null}
    </SectionCard>
  );
}
