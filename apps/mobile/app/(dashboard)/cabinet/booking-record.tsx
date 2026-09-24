import { Fragment, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { LayoutList, Palette } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { RecordMark, recordMarkText } from "@/components/ui/RecordMark";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { chooseValue } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { colorName } from "@babun/shared/common/utils/colors";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import { useTeams } from "@/features/reference/queries";
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
// ПОРЯДОК СЕКЦИЙ = ПОРЯДОК ПРАВИЛА (владелец 2026-09-06: «продумай этот блок,
// мне не нравится, как оно выглядит»). Цвет разрешается так: рука человека →
// первая незакрытая дыра → обычный цвет → запасной. Страница же показывала
// обычный цвет ПЕРВЫМ, а дыры последними, то есть две последние ступени стояли
// сверху. Человек читает список сверху вниз и достраивает неправильную модель:
// «сначала берётся цвет команды, а дыры где-то сбоку», — хотя дыра ПЕРЕБИВАЕТ
// цвет команды. Теперь экран читается тем же порядком, которым работает
// правило, и объяснять его словами не нужно.
//
// СВЕРХУ — ЛЕГЕНДА, А НЕ ОДИН ОБРАЗЕЦ (владелец 2026-09-24: «в настройках —
// какая автоматизация цветов будет»). Рядом стоят настоящие блоки календаря на
// каждый случай правила: обычная запись и каждая незакрытая дыра — ровно так,
// как они лягут на сетку. Автоматизация читается одним взглядом, без слов, и
// перекрашивается в тот же кадр, что и строка ниже: лист цвета закрывает
// только низ экрана.
//
// Блоки формы уехали своей страницей: четыре тумблера здесь переполняли экран,
// а обещание «всё видно сразу» дороже одной лишней двери.
//
// Что нельзя выключить — клиент, время, команда, услуги с итогом — здесь не
// показано вовсе: строка-нельзя не настройка (тот же закон, что снял
// «Позвонить · всегда» со «Способов связи»).

type ColorTarget = ColorSituation | "fallback";

export default function BookingRecordSettingsScreen() {
  const t = useThemeColors();
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

  // «ОБЫЧНАЯ» В ЛЕГЕНДЕ — ЦВЕТОМ ПЕРВОЙ КОМАНДЫ: любое из трёх правил падает
  // на цвет команды, когда своего цвета нет, а без команд красит запасной.
  const { data: teams = [] } = useTeams();
  const ordinary = teams[0]?.color || fallback;
  // Ситуация «Не красить» в легенде показывает то, что покрасит вместо неё, —
  // обычный цвет.
  const legend = [
    { id: "ordinary", title: "Обычная", color: ordinary },
    ...situations.map((s) => ({
      id: s.id,
      title: s.label,
      color: palette[s.id] ?? ordinary,
    })),
  ];

  const blocksSub =
    blocks.length === BOOKING_BLOCKS.length
      ? "Все блоки"
      : BOOKING_BLOCKS.filter((b) => blocks.includes(b.id))
          .map((b) => b.label)
          .join(" · ") || "Ни одного";

  return (
    <Screen>
      {/* Заголовок = слово двери: развилка «Запись» уже называется «Запись»,
          и два экрана подряд под одним именем путали, где ты. */}
      <ScreenHeader title="Страница записи" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {/* ЛЕГЕНДА — НАСТОЯЩИЕ БЛОКИ КАЛЕНДАРЯ: та же плотная заливка, тот же
            контур и радиус (общий `RecordMark`), поэтому разойтись с сеткой они
            не могут. */}
        {/* ПОДПИСЬ ВНУТРИ КАРТОЧКИ, как на соседних страницах сценария
            («Запись», «Событие»): канон — один способ подписи на путь. */}
        <SectionCard title="Как выглядит" padded>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {legend.map((item) => (
            <View key={item.id} style={{ flex: 1, minWidth: 0 }}>
              <RecordMark hue={item.color} full size={58}>
                <Text
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.2}
                  style={{
                    fontSize: 13,
                    lineHeight: 16,
                    fontWeight: "700",
                    color: recordMarkText(item.color, t.ink),
                  }}
                >
                  {item.title}
                </Text>
              </RecordMark>
            </View>
          ))}
        </View>
        </SectionCard>

        {/* ЧЕГО НЕ ХВАТАЕТ — цвет отвечает на вопрос, а не украшает. Порядок
            строк и есть порядок важности: первая незакрытая сверху и красит.
            Секция стоит ПЕРВОЙ, потому что первой и срабатывает: дыра
            перебивает и цвет команды, и цвет метки. */}
        <SectionCard title="Чего не хватает">
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

        {/* ДВЕ КАРТОЧКИ, А НЕ ОДНА СО ШВОМ: у правила плитка со значком, у
            запасного цвета — образец блока, и рядом в одной карточке два
            разных материала читались как склеенные куски разных списков.
            Вопросы тоже разные: «что считать обычным цветом» и «чем красить,
            когда не сказало ничто». */}
        <SectionCard title="Обычный цвет">
          {/* Правило называется вслух и живёт в одном месте: календарь и форма
              красят запись одинаково, потому что спрашивают его. */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Palette}
            title="Правило"
            sub={ruleLabel}
            onPress={pickRule}
          />
        </SectionCard>
        <SectionCard>
          <SettingsRow
            swatch={fallback}
            title="Если цвета нет"
            sub={colorName(fallback)}
            onPress={() => openColor("fallback")}
          />
        </SectionCard>

        <SectionCard title="Форма">
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
