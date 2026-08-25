import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check, MapPin, Settings2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// ВЫХОДНОЙ НА ЭТОТ ДЕНЬ ЖИВЁТ ЗДЕСЬ ЖЕ (владелец 2026-08-17): «через метки
// можно было сразу поставить выходной только на этот день, и оно просто меняется
// как выходной». Лист уже открывается тапом по числу и уже про ЭТОТ день —
// значит и «мы сегодня не работаем» спрашивается тут, а не на отдельной
// странице особых дней, куда за одним тумблером никто не пойдёт. Пишется
// date-override графика команды: только эта дата, недельный график не тронут.
//
// Метка дня (web parity CityPickerModal, Sprint 029) — нижний лист (закон
// «создание — листом», канон BottomSheet). Открывается тапом по числу ВСЕГДА:
// шапка — «Метка» + дата; список — тонированная
// плитка-пин, имя, галочка на активной; тап по активной строке снимает метку
// (web v501 — отдельного «Снять метку» нет, v693). Пустой список — честное
// состояние с прямой дорогой «Добавить метки».

export interface CityOption {
  name: string;
  color: string;
}

export function DayLabelSheet({
  visible,
  dateKey,
  options,
  selected,
  onPick,
  onClear,
  onClose,
  onSettings,
  dayOff,
  onToggleDayOff,
}: {
  visible: boolean;
  /** YYYY-MM-DD дня, чью метку меняем — подзаголовок шапки. */
  dateKey: string;
  options: CityOption[];
  /** Текущая метка дня (имя) или "". */
  selected: string;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Шестерёнка в шапке — настройки меток активной команды. */
  onSettings?: () => void;
  /** Этот день уже помечен выходным (date-override графика команды). */
  dayOff?: boolean;
  /** Без обработчика строки «Выходной» нет вовсе — так на личном календаре,
   *  где графика команды не существует. */
  onToggleDayOff?: (next: boolean) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();

  // Заморозка на время анимации закрытия: родитель обнуляет дату сразу, а
  // лист уезжает ещё 240 мс — без заморозки подзаголовок прыгал на сегодня
  // и только что поставленная галочка гасла прямо на глазах.
  const lastShown = useRef({ dateKey, selected, dayOff: !!dayOff });
  if (visible) lastShown.current = { dateKey, selected, dayOff: !!dayOff };
  const shown = visible
    ? { dateKey, selected, dayOff: !!dayOff }
    : lastShown.current;

  const dateLabel = (() => {
    const s = parseYMD(shown.dateKey).toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const handlePick = (name: string) => {
    haptics.tap();
    // Тап по активной метке = снять её (web v501: «не могу отменить выбор»).
    if (name === shown.selected) onClear();
    else onPick(name);
  };

  return (
    <BottomSheet padded={false} visible={visible} onClose={onClose}>
      <View
        className="px-5 pt-1"
        // Канон нижнего отступа листов (ClientsFilterSheet): home-индикатор
        // не срезает последнюю строку, без него — честные 24.
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        {/* ИМЯ ЛИСТА — ПО ЦЕНТРУ, НАСТРОЙКИ — СПРАВА ПОЛЗУНКАМИ (владелец
            2026-08-24): «метка должна быть посередине, справа шестерёнка —
            знаешь, как ты делал в финансах, ползунки красивые». Тот же глиф
            `Settings2`, что в шапке счетов и в панелях финансов: один значок —
            одно значение на весь продукт. Слева пустое место ровно в ширину
            кнопки, иначе «по центру» съезжает на ширину шестерёнки. */}
        <View className="flex-row items-start">
          <View style={{ width: 44 }} />
          <View className="flex-1 items-center" style={{ minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.2}
              className="text-[17px] font-semibold"
              style={{ color: t.ink }}
            >
              Метка
            </Text>
            {/* ВЫХОДНОЙ ПИШЕТСЯ НА МЕСТЕ МЕТКИ (владелец 2026-08-24): «когда
                выбираешь выходной — там, где метка, пишется: чт, 27 число, и
                там пишется выходной». Слово в подзаголовке — то же, что видно
                над датой в календаре, и читается как метка дня. */}
            <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
              {shown.dayOff ? `${dateLabel} · Выходной` : dateLabel}
            </Text>
          </View>
          {onSettings ? (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel="Настроить метки"
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              <Settings2 color={t.sub} size={ICON.sm} strokeWidth={2} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* ОДНО СЛОВО БЕЗ ОБЪЯСНЕНИЙ (владелец 2026-08-24): «тумблер выходной,
            слово только выходной, без каких-либо объяснений». Строка «Метки —
            Настроить» ушла в шестерёнку шапки: дважды одну дверь не рисуют. */}
        {onToggleDayOff ? (
          <View
            className="mt-3 overflow-hidden"
            style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
          >
            <SwitchRow
              label="Выходной"
              value={shown.dayOff}
              onChange={onToggleDayOff}
            />
          </View>
        ) : null}

        {/* МЕТОК НЕТ — И ГОВОРИТЬ НЕ О ЧЕМ (владелец 2026-08-24): «если в
            настройках нет — тогда можно просто выбрать выходной без меток».
            Абзац-объяснение снесён вместе с кнопкой: дверь в настройки уже
            стоит шестерёнкой в шапке. */}
        {options.length === 0 ? null : (
          <View
            className="mt-3 overflow-hidden"
            style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
          >
            <ScrollView style={{ maxHeight: 380 }} bounces={false}>
              {options.map((o, i) => {
                const active = o.name === shown.selected;
                return (
                  <View key={o.name}>
                    {i > 0 ? (
                      // 56 = 16 + 28 + 12: разделитель в линию с текстом
                      // после плитки-пина (iOS inset separator).
                      <View
                        style={{ height: 1, marginLeft: 56, backgroundColor: t.separator }}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => handlePick(o.name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        active ? `${o.name} — снять метку` : o.name
                      }
                      className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                      style={{ minHeight: 48 }}
                    >
                      <View
                        className="items-center justify-center"
                        style={{
                          height: 28,
                          width: 28,
                          borderRadius: t.radius.card,
                          backgroundColor: o.color,
                        }}
                      >
                        <MapPin color={t.onAccent} size={16} strokeWidth={2.2} />
                      </View>
                      {/* Активная строка — акцент+semibold: единая грамматика
                          одиночного выбора (эталон PeriodPresetModal). */}
                      <Text
                        className="flex-1"
                        style={{
                          fontSize: 15,
                          fontWeight: active ? "600" : "500",
                          color: active ? t.accent : t.ink,
                        }}
                      >
                        {o.name}
                      </Text>
                      {active ? (
                        <Check color={t.accent} size={18} strokeWidth={2.5} />
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
