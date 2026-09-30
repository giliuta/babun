import { Fragment, useState } from "react";
import { View } from "react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import type { ViewSection } from "../master-page/rights-view-sections";
import { compositeRow } from "../master-page/composite-rows";
import { rightLook } from "./right-look";
import { RightSheet } from "./RightSheet";
import { isClosedStep, rightTitle, stepDanger, stepWord } from "./right-words";

// ПРАВА КОМАНДЫ — СТРОКАМИ НАСТРОЕК (владелец 29.09, на настройках календаря:
// «захожу в календарь команда один, и там полностью все настройки по каждому
// — вот так»). Каждое право — строка с цветной плиткой, как «Часовой пояс» или
// «Услуги»: имя права, под ним — его ступень словом этого права. Тап
// поднимает шторку, где сверху сам блок так, как его увидит сотрудник, а
// ниже — ступени (`RightSheet`). Кнопки «Сохранить» нет — выбранное ложится
// сразу.
//
// Одно тело на главную страницу сотрудника (под лентой команд) и на страницу
// шаблона: права одной команды не имеют права выглядеть в двух местах
// по-разному.

/** Отступ шва между строками — до текста, мимо плитки (как в «Кабинете»). */
const ROW_SEAM_INSET = 48;

export function TeamRightsCards({
  blocks,
  sections,
  levels,
  sheetSubtitle,
  teamName,
  teamColor,
  busyKey,
  onPick,
  onSectionLayout,
}: {
  blocks: readonly AccessBlock[];
  sections: readonly ViewSection[];
  /** Положения всех живых прав этой команды — с тем, что выбрано сейчас. */
  levels: Readonly<Record<string, AccessLevel>>;
  /** Чьё и где — у права команды «Dmitry · Команда 1», у права на всю
   *  компанию без имени команды: там оно не про неё. */
  sheetSubtitle?: (block: AccessBlock) => string | undefined;
  teamName: string;
  teamColor: string;
  /** Право, которое сейчас сохраняется: вторая запись ждёт первую. */
  busyKey: string | null;
  onPick: (block: AccessBlock, level: AccessLevel) => void;
  /** Где встала карточка раздела — чтобы страница прокрутила к нему. */
  onSectionLayout?: (section: ViewSection, y: number) => void;
}) {
  const t = useThemeColors();
  /** Право, чья шторка открыта; держится, пока шторка уезжает. */
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Строка берётся из карточек, а не из реестра: у «Услуг», «Цен» и «Времени»
  // свои ступени (`composite-rows`).
  const sheetRow = sections.flatMap((section) => section.rows).find((row) => row.block.key === sheetKey) ?? null;
  const sheetBlock = sheetRow?.block ?? blocks.find((block) => block.key === sheetKey) ?? null;
  const composite = sheetBlock ? compositeRow(sheetBlock.key) : undefined;
  const previewLevels = composite
    ? (chosen: AccessLevel) => ({
        ...levels,
        ...composite.changesFor(chosen, (key) => levels[key] ?? "off"),
      })
    : undefined;

  const open = (block: AccessBlock) => {
    // Две записи не делят один снимок карты. Отказ — вслух: короткий тик в
    // палец, иначе строка выглядит сломанной, а не занятой.
    if (busyKey !== null) {
      haptics.warning();
      return;
    }
    haptics.tap();
    setSheetKey(block.key);
    setSheetOpen(true);
  };

  return (
    <>
      {sections.map((section) => (
        <View
          key={section.key}
          onLayout={onSectionLayout ? (event) => onSectionLayout(section, event.nativeEvent.layout.y) : undefined}
        >
          {/* Пустая шапка — карточка без шапки: на странице одного раздела
              его имя уже стоит в шапке страницы. */}
          <SectionCard title={section.title || undefined} padded={false}>
            {section.rows.map((row, i) => {
              const look = rightLook(row.block.key);
              const closed = isClosedStep(row.level);
              const danger = !closed && stepDanger(row.block, row.level) !== null;
              return (
                <Fragment key={row.block.key}>
                  {i > 0 ? <Divider inset={ROW_SEAM_INSET} /> : null}
                  <View style={{ opacity: busyKey === row.block.key ? 0.5 : 1 }}>
                    <SettingsRow
                      tile={look.tile}
                      icon={look.icon}
                      title={rightTitle(row.block)}
                      // СЛЕВА ПРАВО, СПРАВА ЕГО СТУПЕНЬ (владелец 29.09: «слева
                      // метка дня, справа уже показано, что он видит или не
                      // видит»).
                      value={stepWord(row.block, row.level, levels)}
                      valueQuiet
                      valueColor={closed ? t.faint : danger ? t.warning : t.ink}
                      onPress={() => open(row.block)}
                    />
                  </View>
                </Fragment>
              );
            })}
          </SectionCard>
        </View>
      ))}
      <RightSheet
        visible={sheetOpen}
        block={sheetBlock}
        blocks={blocks}
        levels={levels}
        subtitle={sheetBlock && sheetSubtitle ? sheetSubtitle(sheetBlock) : undefined}
        teamName={teamName}
        teamColor={teamColor}
        busy={busyKey !== null}
        rowLevel={composite ? sheetRow?.level : undefined}
        previewLevels={previewLevels}
        locked={sheetRow?.locked}
        onPick={onPick}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
