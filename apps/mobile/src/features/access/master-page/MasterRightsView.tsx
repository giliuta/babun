import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import type { RightsArea } from "./master-draft";
import { SEGMENT_WORD, levelSentence } from "./rights-copy";
import { rightsSections, type LevelReader } from "./rights-rows";

// «ПРАВА» МАСТЕРА — ОДНА СТРАНИЦА НА ЧЕРНОВИК, ПРИГЛАШЕНИЕ И СОТРУДНИКА
// (владелец 15.09: «права — по-другому»). У каждого блока одна и та же строка:
// название, ФРАЗА ПРО ПОСЛЕДСТВИЕ и сегмент положений.
//
// СТРОКА ОТВЕЧАЕТ НА ВОПРОС ВЛАДЕЛЬЦА, А НЕ НАЗЫВАЕТ ТЕРМИН (владелец 20.09:
// «надо чётко показывать, что он может видеть, что может редактировать и что
// может делать»). Поэтому под названием стоит фраза выбранного положения —
// «Записи без денег: ни цены, ни долга», — а не слово «Скрыт».
//
// СЕГМЕНТ ВМЕСТО ШТОРКИ. Пресетов владелец не захотел («первой одной строкой
// не надо»), то есть список проходится целиком каждый раз: три положения
// видны сразу и ставятся одним касанием, вместо «тап → шторка → тап → закрыть».
// Кнопки «Сохранить» нет — выбранное ложится сразу.
//
// СТРОК ТОЛЬКО У ЖИВЫХ БЛОКОВ (STORY-083): пятнадцать из двадцати одного
// сервер не проверяет и не отказывает при записи, и настройка, которая
// сохраняется и ничего не делает, хуже отсутствующей.
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
  busyKey = null,
  onPick,
  area,
  onPreview,
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
  /** Ключ блока, который сейчас сохраняется, — его строка ждёт ответа. Пока
   *  здесь стоял общий флаг, повторный тап по ЛЮБОЙ строке молча проглатывался
   *  и на экране не менялось ничего: на слабой связи это читается как
   *  сломанная кнопка. */
  busyKey?: string | null;
  onPick: (block: AccessBlock, level: AccessLevel, teamId: string | null) => void;
  /** Раздел, с которого открыли страницу, — к нему и прокручиваем. */
  area?: RightsArea;
  /** «Посмотреть его глазами»: включает зеркало и уводит в продукт. Нет —
   *  кнопки нет (например, пока не пришёл реестр блоков). */
  onPreview?: () => void;
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);

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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Права" subtitle={subtitle} onBack={onBack} seam={!withChips} />
      {withChips ? (
        <ScopeChips items={chips} activeId={activeId} onSelect={onSelectTeam} />
      ) : null}
      {/* НИ ОДНОГО ЖИВОГО БЛОКА — ПУСТОЕ СОСТОЯНИЕ, А НЕ ПУСТОЕ ПОЛОТНО. Так
          бывает, когда живы только календарные блоки, а календаря у человека
          нет: без этого под шапкой оставалась белая страница и кнопка внизу. */}
      {sections.length === 0 ? (
        <EmptyState
          fill
          title="Прав пока нет"
          subtitle="Прикрепите человека к календарю — права ставятся в нём."
        />
      ) : (
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
                const saving = busyKey === row.block.key;
                return (
                  <View
                    key={row.block.key}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderTopWidth: i > 0 ? 1 : 0,
                      borderTopColor: t.separator,
                      // Строка, которая сейчас уезжает на сервер, пригашена:
                      // видно, ЧТО именно ждёт ответа.
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={{ ...TYPE.callout, color: t.ink }}>
                      {row.block.title}
                    </Text>
                    {/* ФРАЗА ПОЛОЖЕНИЯ — ответ на вопрос «а что он увидит».
                        Меняется вместе с сегментом, поэтому владелец читает
                        последствие ДО того, как отпустил палец. Набрана тем же
                        кеглем, что и название: она и есть смысл строки, а
                        мельче названия читалась бы как сноска. */}
                    <Text
                      maxFontSizeMultiplier={1.4}
                      style={{ ...TYPE.body, color: t.sub, marginTop: 2, marginBottom: 10 }}
                    >
                      {levelSentence(row.block.key, row.level)}
                    </Text>
                    <SegmentedControl
                      options={row.block.levels.map((value) => ({
                        value,
                        label: SEGMENT_WORD[value],
                      }))}
                      value={row.level}
                      onChange={(level) => {
                        // Две записи не делят один снимок карты. Отказ —
                        // вслух: короткий тик в палец, иначе кнопка выглядит
                        // сломанной, а не занятой.
                        if (busyKey !== null) {
                          haptics.warning();
                          return;
                        }
                        onPick(row.block, level, row.block.scope === "calendar" ? activeId : null);
                      }}
                    />
                  </View>
                );
              })}
            </SectionCard>
          </View>
        ))}
      </ScrollView>
      )}
      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ СТРАНИЦЫ — ВНИЗУ (канон 7.1). Строки прав
          ставятся на месте и ничего не «сохраняют», поэтому футер занят тем,
          ради чего страницу и открывали: посмотреть, что из этого выйдет. */}
      {onPreview ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Посмотреть его глазами" onPress={onPreview} />
        </View>
      ) : null}
    </Screen>
  );
}
