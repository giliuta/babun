import { Pressable, Text, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import type { PersonalEventType } from "@babun/shared/local/personal-event-types";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { eventTypeIcon } from "@/features/calendar/event-type-icons";
import { durationLabel } from "@/features/services/format";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТИП СОБЫТИЯ — СВОИМ БЛОКОМ ПОД ВРЕМЕНЕМ (владелец 2026-09-08: «наверху
// справа переделай тип на метку, как в клиентах, а ниже под временем мы
// сделаем новый блок — тип события»).
//
// До этого тип стоял второй плиткой шапки, рядом с командой: пока его не
// выбрали, плитка была серым кружком со словом «Тип» — самая тихая вещь
// экрана на месте, где у записи стоит метка выезда. Владелец: «не нравится,
// как выглядит кнопка тип — серая иконка».
//
// ВЫБОР ЗДЕСЬ ОДНИМ КАСАНИЕМ, А НЕ ЧЕРЕЗ ЛИСТ. Типов у бизнеса пять-восемь,
// они помещаются на экран целиком — открывать ради них шторку значит платить
// два касания за то, что видно и так. Каждый тип показан своим значком из
// справочника и своим цветом: цвет события и есть цвет типа, и выбор его
// сразу и показывает.
//
// Сетка ПЕРЕНОСИТСЯ, а не скроллится вбок: горизонтальная лента прячет
// хвост списка, и типы за краем экрана перестают существовать для человека.

/** Четыре плитки в ряд — на 393pt это 88pt на плитку, кружок 44 и подпись в
 *  две строки. Пятая не влезала подписью «Выходной». */
const COLUMNS = 4;
const CIRCLE = 44;

export function EventTypeBlock({
  types,
  selectedId,
  onSelect,
  onSettings,
}: {
  types: readonly PersonalEventType[];
  /** Выбранный тип; `null` — событие без типа (оно называется «Событие»). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Кабинет → «Типы событий»: там их заводят, красят и переименовывают. */
  onSettings: () => void;
}) {
  const t = useThemeColors();
  const selected = types.find((type) => type.id === selectedId) ?? null;

  return (
    <SectionCard title="Тип события">
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          paddingHorizontal: 8,
          paddingTop: 4,
          paddingBottom: 10,
        }}
      >
        {types.map((type) => (
          <TypeTile
            key={type.id}
            label={type.label}
            color={type.color}
            icon={type.icon}
            selected={type.id === selectedId}
            hint={`Длительность ${durationLabel(type.defaultDuration)}`}
            onPress={() => onSelect(type.id)}
          />
        ))}
        {/* ПОСЛЕДНЯЯ ПЛИТКА — ДВЕРЬ В СПРАВОЧНИК, тем же размером: список
            типов ведёт бизнес, и добавить свой тип должно быть видно оттуда,
            где их выбирают. */}
        <TypeTile
          label="Настроить"
          color={t.body}
          gear
          selected={false}
          hint="Кабинет → «Типы событий»"
          onPress={onSettings}
        />
      </View>

      {/* ЧТО ДАЁТ ТИП — ОДНОЙ ТИХОЙ СТРОКОЙ. Выбор типа перекрашивает всё
          событие и ставит конец времени по длительности типа; без этой
          строки время «само» съезжало, и объяснения этому на экране не было. */}
      {selected ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 9,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: selected.color,
            }}
          />
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ flex: 1, fontSize: 13, color: t.sub }}
          >
            {`Красит событие · ${durationLabel(selected.defaultDuration)} по умолчанию`}
          </Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function TypeTile({
  label,
  color,
  icon,
  gear,
  selected,
  hint,
  onPress,
}: {
  label: string;
  color: string;
  icon?: string;
  /** Плитка справочника: шестерёнка вместо значка типа. */
  gear?: boolean;
  selected: boolean;
  hint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const Icon = gear ? Settings2 : eventTypeIcon(icon);
  // Подложка кружка — цвет типа в 12%. Токены темы записаны в `rgba()`, и
  // приписать к ним альфу строкой нельзя: `rgba(...)1f` — не цвет, RN рисует
  // им ЧЁРНЫЙ кружок (поймано на симуляторе: плитка «Настроить» вышла тёмным
  // пятном среди пастельных). Тень берём только у честного `#rrggbb`.
  const tint = /^#[0-9a-f]{6}$/i.test(color) ? `${color}1f` : t.rowFill;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        width: `${100 / COLUMNS}%`,
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: CIRCLE,
          height: CIRCLE,
          borderRadius: CIRCLE / 2,
          alignItems: "center",
          justifyContent: "center",
          // Выбранный — залит цветом типа; остальные — той же краской в 12%,
          // как кружки плиток команды и метки в шапке.
          backgroundColor: selected ? color : tint,
        }}
      >
        <Icon
          color={selected ? "#fff" : color}
          size={ICON.md}
          strokeWidth={selected ? 2.4 : 2}
        />
      </View>
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={1.2}
        style={{
          marginTop: 6,
          fontSize: 12,
          lineHeight: 15,
          textAlign: "center",
          fontWeight: selected ? "700" : "500",
          color: selected ? t.ink : t.sub,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
