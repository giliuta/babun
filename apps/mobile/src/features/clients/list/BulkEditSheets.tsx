import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import { TagPickerSheet } from "@/features/clients/TagPickerSheet";
import { CUSTOM_SOURCE_ICON, SOURCE_ICONS } from "@/features/clients/source-icons";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import type { ClientsList } from "./use-clients-list";

// ШТОРКИ ПАЧКИ — ТЕ ЖЕ, ЧТО У КАРТОЧКИ КЛИЕНТА: теги — `TagPickerSheet` с
// «Применить», источник — `PickerSheet` «Источник обращения», команда —
// выбор значения (`ValuePickerSheet`, тап выбирает и закрывает). Своей
// вёрстки строки здесь нет — только что подставить и что вызвать.

export function BulkEditSheets({ list }: { list: ClientsList }) {
  const t = useThemeColors();
  const { data: teams = [] } = useTeams({ display: true });
  const {
    bulkSheet,
    closeBulkSheet,
    applyTags,
    applyTeam,
    applySource,
    sheetTags,
    sheetSources,
    sheetTeam,
  } = list;
  const count = bulkSheet?.clients.length ?? 0;
  return (
    <>
      <TagPickerSheet
        visible={bulkSheet?.kind === "tags"}
        title={bulkSheet?.kind === "tags" && bulkSheet.mode === "remove" ? "Убрать теги" : "Поставить теги"}
        markMain={bulkSheet?.kind === "tags" && bulkSheet.mode === "add"}
        tags={sheetTags}
        selected={[]}
        onApply={applyTags}
        onClose={closeBulkSheet}
      />
      <ValuePickerSheet
        visible={bulkSheet?.kind === "team"}
        title="Команда клиента"
        // Неактивные команды `useTeams` не отдаёт: перевести в них нельзя.
        options={teams.map((team) => ({
          id: team.id,
          label: team.name,
          color: team.color || getAvatarColor(team.name),
        }))}
        selectedId={sheetTeam}
        onPick={applyTeam}
        onClose={closeBulkSheet}
      />
      <PickerSheet
        visible={bulkSheet?.kind === "source"}
        title="Источник обращения"
        subtitle={`Выбрано клиентов: ${count}`}
        items={sheetSources.map((o) => ({
          id: o.key,
          label: o.label,
          icon: (o.source.key ? SOURCE_ICONS[o.source.key] : undefined) ?? CUSTOM_SOURCE_ICON,
          color: t.accent,
          onPress: () => applySource(o.key),
        }))}
        emptyText="Источников нет"
        onClose={closeBulkSheet}
      />
    </>
  );
}
