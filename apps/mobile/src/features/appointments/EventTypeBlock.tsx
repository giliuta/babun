import { Pressable, ScrollView, Text, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import type { PersonalEventType } from "@babun/shared/local/personal-event-types";
import { SectionCard } from "@/components/ui/SectionCard";
import { eventTypeIcon } from "@/features/calendar/event-type-icons";
import { durationLabel } from "@/features/services/format";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТИП СОБЫТИЯ — СВОИМ БЛОКОМ ПОД ВРЕМЕНЕМ (владелец 2026-09-08: «наверху
// справа переделай тип на метку, как в клиентах, а ниже под временем мы
// сделаем новый блок — тип события»).
//
// ЛЕНТА, А НЕ СЕТКА (владелец, второй заход: «сделай это компактней, и при
// этом всё можно будет двигать вправо: если я добавлю тридцать, она будет
// просто забивать этот экран»). Первая версия переносила плитки строками —
// на пяти типах это читалось, на тридцати блок съел бы страницу. Лента растёт
// вбок и стоит ровно две строки текста при любом числе типов.
//
// НАСТРОЙКИ — СПРАВА В ШАПКЕ БЛОКА, а не плиткой в ленте (владелец: «этот
// значок поставь просто „типы события“ с правой стороны, чтоб можно было
// всегда открывать настройки»). Плитка-шестерёнка уезжала за край вместе с
// лентой — то есть дверь в справочник пряталась ровно тогда, когда типов
// много и она нужнее всего. Тем же днём владелец уточнил: не слово, а
// ЗНАЧОК ползунков — тот же, которым в продукте обозначены настройки; слово
// «Типы событий» рядом с заголовком «ТИП СОБЫТИЯ» читалось как второй
// заголовок. Значок — ползунки (владелец 2026-09-08 прислал картинкой): не
// шестерёнка «мини-настроек» листа, а два ползунка — «здесь настраивают
// список», а не «здесь настройки экрана». Подпись жива в озвучке.
//
// Каждый тип показан своим значком из справочника и своим цветом: цвет
// события и есть цвет типа, и выбор его сразу показывает.

/** Ширина плитки: кружок 40 + подпись в одну строку. Пять с половиной
 *  помещаются в 393pt — обрезанная шестая и есть приглашение листать. */
const TILE_W = 68;
const CIRCLE = 40;

export function EventTypeBlock({
  types,
  selectedId,
  loading,
  onSelect,
  onSettings,
}: {
  types: readonly PersonalEventType[];
  /** Выбранный тип; `null` — событие без типа (оно называется «Событие»). */
  selectedId: string | null;
  /** Справочник ещё едет: «Типов пока нет» в этот момент — неправда. */
  loading?: boolean;
  onSelect: (id: string) => void;
  /** Справочник типов: там их заводят, красят и переименовывают. */
  onSettings: () => void;
}) {
  const t = useThemeColors();
  const selected = types.find((type) => type.id === selectedId) ?? null;

  return (
    <SectionCard
      title="Тип события"
      action={{
        label: "Типы событий",
        icon: Settings2,
        onPress: onSettings,
      }}
    >
      {types.length === 0 ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ paddingHorizontal: 16, paddingBottom: 12, fontSize: 15, color: t.placeholder }}
        >
          {loading ? "Загружаем типы…" : "Типов пока нет — заведите их в настройках."}
        </Text>
      ) : (
        // px через contentContainerStyle: className на ScrollView NativeWind
        // молча роняет, и лента липла бы к краям карточки.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}
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
        </ScrollView>
      )}

      {/* ЧТО ДАЁТ ТИП — ОДНОЙ ТИХОЙ СТРОКОЙ. Длительность здесь названа
          «по умолчанию» не для красоты: выбранное руками время сильнее её
          и тип его не перебивает. */}
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
  selected,
  hint,
  onPress,
}: {
  label: string;
  color: string;
  icon: string;
  selected: boolean;
  hint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const Icon = eventTypeIcon(icon);
  // Подложка кружка — цвет типа в 12%. Токены темы записаны в `rgba()`, и
  // приписать к ним альфу строкой нельзя: `rgba(...)1f` — не цвет, RN рисует
  // им чёрный кружок (поймано на симуляторе 2026-09-08).
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
        width: TILE_W,
        alignItems: "center",
        paddingVertical: 6,
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
          // Выбранный залит цветом типа; остальные — той же краской в 12%,
          // как кружки плиток команды и метки в шапке.
          backgroundColor: selected ? color : tint,
        }}
      >
        <Icon
          color={selected ? "#fff" : color}
          size={20}
          strokeWidth={selected ? 2.4 : 2}
        />
      </View>
      {/* Две строки, а не одна: «Выезд в офис» на 68pt в одну строку
          обрезался до «Выезд в…», и тип переставал называться. Высота ленты
          от этого выросла на 14pt — дешевле, чем безымянная плитка. */}
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={1.2}
        style={{
          marginTop: 5,
          fontSize: 11,
          lineHeight: 14,
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
