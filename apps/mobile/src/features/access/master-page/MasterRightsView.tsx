import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { NavRow } from "@/components/ui/card-rows";
import { OptionSheet } from "@/components/ui/OptionSheet";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { LEVEL_WORD, type AccessBlock, type AccessLevel } from "../access-map";
import type { RightsArea } from "./master-draft";
import { levelColor } from "./MasterCardView";
import { rightsSections, type LevelReader } from "./rights-rows";

// «ПРАВА» МАСТЕРА — ОДНА СТРАНИЦА НА ЧЕРНОВИК, ПРИГЛАШЕНИЕ И СОТРУДНИКА
// (владелец 15.09: «права — по-другому»). У каждого блока одна и та же строка:
// название, слово положения, шеврон → шторка выбора. Двух видов строки на
// одной странице нет: и двухпозиционный блок, и «Какие клиенты» выглядят так
// же. Кнопки «Сохранить» нет — выбранное ложится сразу; «выставить весь
// раздел» нет — это заготовка, от заготовок владелец отказался 14.09.
//
// Календарей два и больше — сверху лента чипов: она переключает только
// строки блоков календаря, блоки компании стоят в конце своего раздела.
// Календаря нет вовсе — на странице только строки компании: календарную
// строку выставить некуда, а пригашенной она читалась бы сломанной.

export function MasterRightsView({
  subtitle,
  onBack,
  blocks,
  teams,
  teamIds,
  activeTeamId,
  onSelectTeam,
  levelOf,
  canEdit,
  busy = false,
  onPick,
  area,
}: {
  subtitle?: string;
  onBack: () => void;
  blocks: readonly AccessBlock[];
  teams: readonly Team[];
  /** Календари мастера, первый — домашний. */
  teamIds: readonly string[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  levelOf: LevelReader;
  /** Нет — строка пригашена и без шеврона: блок заперт. */
  canEdit: (block: AccessBlock) => boolean;
  /** Запись уже идёт — новый выбор не открываем, но страницу не гасим:
   *  пригашенная строка значит «блок заперт», а не «сохраняется». */
  busy?: boolean;
  onPick: (block: AccessBlock, level: AccessLevel, teamId: string | null) => void;
  /** Раздел, с которого открыли страницу, — к нему и прокручиваем. */
  area?: RightsArea;
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  // Шторка держит последний блок, пока уезжает: иначе заголовок и строки
  // исчезали бы посреди анимации.
  const [sheetBlock, setSheetBlock] = useState<AccessBlock | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const chips = teamIds
    .map((id) => teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined)
    .map((team) => ({ id: team.id, name: team.name, color: team.color }));
  const withChips = chips.length >= 2;
  // Выбранный календарь — только из тех, у кого есть чип: скрытый календарь
  // (архив) правился бы без подписи, а сервер молча снял бы правку.
  const activeId =
    activeTeamId !== null && chips.some((chip) => chip.id === activeTeamId)
      ? activeTeamId
      : (chips[0]?.id ?? null);
  const sections = rightsSections(blocks, levelOf, activeId);
  const sheetTeam = sheetBlock?.scope === "calendar" ? activeId : null;

  return (
    <>
      <Screen edges={["top"]}>
        <ScreenHeader title="Права" subtitle={subtitle} onBack={onBack} seam={!withChips} />
        {withChips ? (
          <ScopeChips items={chips} activeId={activeId} onSelect={onSelectTeam} />
        ) : null}
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 48 }}
        >
          {sections.map((section) => (
            <View
              key={section.area}
              onLayout={(event) => {
                if (section.area !== area || scrolled.current) return;
                scrolled.current = true;
                scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
              }}
            >
              <SectionCard title={section.title} padded={false}>
                {section.rows.map((row, i) => {
                  const isLocked = !canEdit(row.block);
                  return (
                    <NavRow
                      key={row.block.key}
                      label={row.block.title}
                      value={LEVEL_WORD[row.level]}
                      valueColor={levelColor(t, row.level)}
                      separated={i > 0}
                      dimmed={isLocked}
                      onPress={
                        isLocked
                          ? undefined
                          : () => {
                              // Шеврон на месте и во время записи: тап просто
                              // ждёт ответа, строка не мигает серым.
                              if (busy) return;
                              setSheetBlock(row.block);
                              setSheetOpen(true);
                            }
                      }
                    />
                  );
                })}
              </SectionCard>
            </View>
          ))}
        </ScrollView>
      </Screen>
      {sheetBlock ? (
        <OptionSheet
          visible={sheetOpen}
          title={sheetBlock.title}
          options={sheetBlock.levels.map((value) => ({ value, label: LEVEL_WORD[value] }))}
          value={levelOf(sheetBlock, sheetTeam)}
          onPick={(level) => {
            if (busy) return;
            onPick(sheetBlock, level, sheetTeam);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </>
  );
}
