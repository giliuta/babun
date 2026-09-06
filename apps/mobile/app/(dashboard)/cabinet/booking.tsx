import { Fragment, useState } from "react";
import { ScrollView } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { LayoutList, Palette } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { chooseValue } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { colorName } from "@babun/shared/common/utils/colors";
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
  useFallbackColor,
  useSetAutoColorRule,
  useSetFallbackColor,
  useSetSituationColor,
  useSituationPalette,
  type AutoColorRule,
} from "@/features/appointments/booking-prefs";

// «ЗАПИСЬ» — НАСТРОЙКА САМОЙ ФОРМЫ И ЦВЕТА ЗАПИСИ (владелец 2026-09-05: «в
// настройках цветовая палитра: если нет клиента — тогда цвет такой-то, тапаю,
// могу выбрать любой… чтобы человек один раз настроил, и всё»).
//
// Три секции и шесть строк. Блоки формы уехали своей страницей: четыре
// тумблера здесь переполняли экран, а обещание «всё видно сразу» дороже одной
// лишней двери.
//
// Что нельзя выключить — клиент, время, команда, услуги с итогом — здесь не
// показано вовсе: строка-нельзя не настройка (тот же закон, что снял
// «Позвонить · всегда» со «Способов связи»).

type ColorTarget = ColorSituation | "fallback";

export default function BookingSettingsScreen() {
  const router = useRouter();
  // ДВЕРЬ «БЛОКИ ФОРМЫ» ОСТАЁТСЯ В ТОМ СТЕКЕ, ГДЕ ЕЁ ОТКРЫЛИ. Эта страница
  // живёт под двумя адресами — /cabinet/booking и /calendar/booking, — и
  // жёсткий push в Кабинет уводил бы человека из календаря посреди настройки
  // (тот же закон навигации, по которому заведены двери «Услуг» и «Меток»).
  const pathname = usePathname();
  const blocksHref = pathname.includes("/calendar/")
    ? "/calendar/booking-blocks"
    : "/cabinet/booking-blocks";
  const blocks = useBookingBlocks();
  const rule = useAutoColorRule();
  const setRule = useSetAutoColorRule();
  const palette = useSituationPalette();
  const setSituationColor = useSetSituationColor();
  const fallback = useFallbackColor();
  const setFallback = useSetFallbackColor();
  const [editing, setEditing] = useState<ColorTarget | null>(null);

  const ruleLabel =
    AUTO_COLOR_RULES.find((r) => r.id === rule)?.label ?? "Цвет команды";

  const pickRule = async () => {
    haptics.tap();
    const picked = await chooseValue<AutoColorRule>(
      "Обычный цвет записи",
      AUTO_COLOR_RULES.map((r) => ({ value: r.id, label: r.label })),
    );
    if (picked?.value) setRule.mutate(picked.value);
  };

  const openColor = (target: ColorTarget) => {
    haptics.tap();
    setEditing(target);
  };

  const editingColor =
    editing === "fallback"
      ? fallback
      : editing
        ? palette[editing] ?? null
        : null;

  // Ситуация про выключенный блок не показывается: у бьюти-мастера объекта нет
  // вовсе, и «нет объекта» для него не дыра, а норма.
  const situations = COLOR_SITUATIONS.filter(
    (s) => s.id !== "noObject" || blocks.includes("object"),
  );

  const blocksSub =
    blocks.length === BOOKING_BLOCKS.length
      ? "все блоки"
      : BOOKING_BLOCKS.filter((b) => blocks.includes(b.id))
          .map((b) => b.label)
          .join(" · ") || "ни одного";

  return (
    <Screen>
      <ScreenHeader title="Запись" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionEyebrow>Цвет</SectionEyebrow>
        <SectionCard>
          {/* Правило называется вслух и живёт в одном месте: календарь и форма
              красят запись одинаково, потому что спрашивают его. */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Palette}
            title="Обычный цвет"
            sub={ruleLabel}
            onPress={pickRule}
          />
          <Divider inset={56} />
          <SettingsRow
            swatch={fallback}
            title="Если цвета нет"
            sub={colorName(fallback)}
            onPress={() => openColor("fallback")}
          />
        </SectionCard>

        {/* ЧЕГО НЕ ХВАТАЕТ — цвет отвечает на вопрос, а не украшает. Порядок
            строк и есть порядок важности: первая незакрытая сверху и красит.
            Секция читается правилом и служит календарю легендой. */}
        <SectionEyebrow>Чего не хватает</SectionEyebrow>
        <SectionCard>
          {situations.map((situation, i) => (
            <Fragment key={situation.id}>
              {i > 0 ? <Divider inset={56} /> : null}
              <SettingsRow
                swatch={palette[situation.id] ?? null}
                title={situation.label}
                sub={colorName(palette[situation.id])}
                onPress={() => openColor(situation.id)}
              />
            </Fragment>
          ))}
        </SectionCard>

        <SectionEyebrow>Форма</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={LayoutList}
            title="Блоки формы"
            sub={blocksSub}
            onPress={() => router.push(blocksHref as never)}
          />
        </SectionCard>
      </ScrollView>

      <ColorSheet
        visible={editing != null}
        onClose={() => setEditing(null)}
        title={
          editing === "fallback"
            ? "Если цвета нет"
            : COLOR_SITUATIONS.find((s) => s.id === editing)?.label
        }
        // «Не красить» вместо «Автоматически»: у ситуации нет автомата — есть
        // отказ от сигнала, и тогда красит следующее правило. У запасного
        // цвета отказаться нельзя: он последняя ступень.
        autoLabel="Не красить"
        allowNone={editing !== "fallback"}
        value={editingColor}
        onPick={(color) => {
          if (!editing) return;
          if (editing === "fallback") {
            if (color) setFallback.mutate(color);
            return;
          }
          setSituationColor.mutate({ situation: editing, color });
        }}
      />
    </Screen>
  );
}
