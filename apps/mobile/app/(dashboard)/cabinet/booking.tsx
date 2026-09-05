import { ScrollView } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ValueRow } from "@/components/ui/ValueRow";
import { chooseValue } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import {
  AUTO_COLOR_RULES,
  BOOKING_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
  useSetAutoColorRule,
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
  const enabled = useBookingBlocks();
  const toggle = useToggleBookingBlock();
  const rule = useAutoColorRule();
  const setRule = useSetAutoColorRule();

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
    </Screen>
  );
}
