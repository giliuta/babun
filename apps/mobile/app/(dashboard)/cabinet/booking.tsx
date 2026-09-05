import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ValueRow } from "@/components/ui/ValueRow";
import { chooseValue } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import {
  COLOR_SITUATIONS,
  type ColorSituation,
} from "@/features/appointments/record-color";
import {
  AUTO_COLOR_RULES,
  BOOKING_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
  useSetAutoColorRule,
  useSetSituationColor,
  useSituationPalette,
  useToggleBookingBlock,
  type AutoColorRule,
} from "@/features/appointments/booking-prefs";

// «ЗАПИСЬ» — НАСТРОЙКА САМОЙ ФОРМЫ (владелец 2026-09-05: «давай сделаем
// страницу, назовём её „Запись“, и там уже можно будет полноценно
// редактировать цветовую гамму и включать те блоки, которые нужны: допустим,
// для бьюти-мастеров объект не нужен»).
//
// Форма записи одна на продукт, а бизнесы разные. До сих пор продукт решал за
// всех: у мастера маникюра в каждой записи стоял блок «Объект», который он
// никогда не заполнял, — и всё равно листал мимо него.
//
// Что нельзя выключить — клиент, время, команда, услуги с итогом — здесь не
// показано вовсе: строка-нельзя не настройка (тот же закон, что снял
// «Позвонить · всегда» со «Способов связи»).

export default function BookingSettingsScreen() {
  const t = useThemeColors();
  const enabled = useBookingBlocks();
  const toggle = useToggleBookingBlock();
  const rule = useAutoColorRule();
  const setRule = useSetAutoColorRule();
  const palette = useSituationPalette();
  const setSituationColor = useSetSituationColor();
  const [editing, setEditing] = useState<ColorSituation | null>(null);

  const ruleLabel =
    AUTO_COLOR_RULES.find((r) => r.id === rule)?.label ?? "Цвет команды";

  const pickRule = async () => {
    haptics.tap();
    const picked = await chooseValue<AutoColorRule>(
      "Цвет записи автоматически",
      AUTO_COLOR_RULES.map((r) => ({ value: r.id, label: r.label })),
    );
    if (picked?.value) setRule.mutate(picked.value);
  };

  return (
    <Screen>
      <ScreenHeader title="Запись" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionEyebrow>Цвет</SectionEyebrow>
        <SectionCard>
          {/* Правило называется вслух и живёт в одном месте: календарь и форма
              красят запись одинаково, потому что спрашивают его. */}
          <ValueRow label="Автоматически" value={ruleLabel} onPress={pickRule} />
        </SectionCard>

        {/* ЦВЕТОВАЯ ПАЛИТРА — «ЧЕГО НЕ ХВАТАЕТ» (владелец 2026-09-05: «если
            нет клиента, тогда цвет такой-то, тапаю — могу выбрать любой; если
            нет объекта — такой-то»). Цвет записи перестал быть украшением: в
            календаре день читается одним взглядом, и незакрытая дыра видна
            прежде, чем бригада выехала. Порядок строк — порядок важности:
            первая незакрытая сверху и красит. */}
        <SectionEyebrow>Цветовая палитра</SectionEyebrow>
        <SectionCard>
          {COLOR_SITUATIONS.map((situation, i) => {
            const color = palette[situation.id];
            return (
              <Pressable
                key={situation.id}
                onPress={() => {
                  haptics.tap();
                  setEditing(situation.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${situation.label}: ${color ? "свой цвет" : "не красит"}`}
                accessibilityHint="Открывает выбор цвета"
                style={({ pressed }) => ({
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: t.separator,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                    {situation.label}
                  </Text>
                  <Text style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
                    {situation.hint}
                  </Text>
                </View>
                {color ? (
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: color,
                    }}
                  />
                ) : (
                  <Text style={{ fontSize: 13, color: t.placeholder }}>
                    не красит
                  </Text>
                )}
              </Pressable>
            );
          })}
        </SectionCard>

        <SectionEyebrow>Блоки</SectionEyebrow>
        <SectionCard>
          {BOOKING_BLOCKS.map((block) => (
            <SwitchRow
              key={block.id}
              label={block.label}
              hint={block.hint}
              value={enabled.includes(block.id)}
              onChange={() => toggle.mutate(block.id)}
            />
          ))}
        </SectionCard>
      </ScrollView>

      <ColorSheet
        visible={editing != null}
        onClose={() => setEditing(null)}
        title={COLOR_SITUATIONS.find((s) => s.id === editing)?.label}
        // «Не красить» вместо «Автоматически»: у ситуации нет автомата — есть
        // отказ от сигнала, и тогда красит следующее правило.
        autoLabel="Не красить"
        value={editing ? palette[editing] ?? null : null}
        onPick={(color) => {
          if (!editing) return;
          setSituationColor.mutate({ situation: editing, color });
        }}
      />
    </Screen>
  );
}
