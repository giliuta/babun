import { useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТОЧНЫЙ АДРЕС — «МИНИ-ДОП» ПОД ГЛАВНОЙ СТРОКОЙ (владелец 2026-09-06:
// «основное — это адрес или ссылка на карту; уточнение можно раскрыть и
// свернуть обратно»; слово «уточнение» владелец отверг — канцелярит).
// Главная строка «Адрес или ссылка на карту» живёт в листе и стоит первой;
// здесь — переключатель «Точный адрес» и его поля: комплекс; подъезд · этаж ·
// квартира; город · индекс; ссылка на карту (только когда главная строка —
// текст: ссылку в главной строке пин дублировал бы). Улицы и дома среди
// полей НЕТ — это и есть главная строка.
//
// Свёрнутая строка не молчит: справа стоит её содержимое («Sunny Court ·
// подъезд 2 · эт. 3 · кв. 5»), обрезанное с НАЧАЛА — хвост «эт. 3 · кв. 5»
// мастеру нужнее названия комплекса. Все поля `live`: черновик держит лист.

export const ADDRESS_DETAILS_LABEL = "Точный адрес";
/** ЧТО ВНУТРИ — СКАЗАНО НА ЗАКРЫТОЙ СТРОКЕ (аудит листа объекта 2026-09-09).
 *  Пустая строка «Точный адрес ›» не отвечала на единственный вопрос, который
 *  у неё возникает: а что там? Человек, вписавший «Karpathou 9, кв. 5» одной
 *  строкой, так и не узнавал, что для квартиры есть своё поле. */
const ADDRESS_DETAILS_HINT = "подъезд, этаж, квартира";

const SHORT: { key: keyof AddressParts; label: string }[] = [
  { key: "entrance", label: "Подъезд" },
  { key: "floor", label: "Этаж" },
  { key: "apartment", label: "Кв." },
];

export function AddressDetailsToggle({
  open,
  summary,
  variant = "row",
  onToggle,
}: {
  open: boolean;
  /** Что уже заполнено — подпись свёрнутой строки (см. composeDetails). */
  summary: string;
  /** `link` — маленькая синяя строка внутри карточки адреса (владелец
   *  2026-09-09: «потом маленькая такая кнопочка синеньким — „точный
   *  адрес“»). Полноразмерная строка на 48pt весила столько же, сколько сам
   *  адрес, хотя это его уточнение. `row` — прежняя строка: она осталась на
   *  публичной странице, где по ней тапает клиент с телефона. */
  variant?: "row" | "link";
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const Chevron = open ? ChevronUp : ChevronDown;
  if (variant === "link") {
    return (
      <Pressable
        onPress={() => {
          haptics.tap();
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          summary ? `${ADDRESS_DETAILS_LABEL}: ${summary}` : ADDRESS_DETAILS_LABEL
        }
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          minHeight: 40,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: t.separator,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 14, fontWeight: "500", color: t.accent }}
        >
          {ADDRESS_DETAILS_LABEL}
        </Text>
        {!open && summary ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            ellipsizeMode="head"
            style={{ flex: 1, fontSize: 13, color: t.sub }}
          >
            {summary}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Chevron color={t.accent} size={14} strokeWidth={2.4} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={
        summary ? `${ADDRESS_DETAILS_LABEL}: ${summary}` : ADDRESS_DETAILS_LABEL
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {ADDRESS_DETAILS_LABEL}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        ellipsizeMode="head"
        style={{
          flex: 1,
          textAlign: "right",
          fontSize: 15,
          fontWeight: summary ? "500" : "400",
          color: summary ? t.ink : t.placeholder,
        }}
      >
        {open ? "" : summary || ADDRESS_DETAILS_HINT}
      </Text>
      <Chevron color={t.chevron} size={17} strokeWidth={2.2} />
    </Pressable>
  );
}

export function AddressDetailsFields({
  parts,
  onChange,
  onEditEnd,
  pin,
  onPinChange,
  onPinEditEnd,
  showPin,
}: {
  /** Точный адрес — части без улицы (см. withoutStreet). */
  parts: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Уход с любого поля — момент записи у правки объекта. */
  onEditEnd?: () => void;
  /** Ссылка на карту (пин) — сырой ввод; проверяет вызывающая сторона. */
  pin: string;
  onPinChange: (next: string) => void;
  onPinEditEnd?: () => void;
  /** Поле пина показывают, только когда главная строка — текст. */
  showPin: boolean;
}) {
  const set = (key: keyof AddressParts) => (value: string) =>
    onChange({ ...parts, [key]: value });
  // ПОЛЯ-ПОДЛОЖКИ, А НЕ ТАБЛИЦА (владелец 2026-09-07: «ну такое, можно
  // сделать лучше; мне нравились старые заметки»). Сетка из строк с подписями
  // и линиями между ячейками читалась ведомостью; подложка с подсказкой внутри
  // — тот же язык, что у заметок записи и объекта, и три коротких поля встают
  // в одну строку высотой 40 вместо 60.
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
      <DetailBox
        label="Комплекс"
        value={parts.complex ?? ""}
        autoCapitalize="words"
        onChange={set("complex")}
        onEditEnd={onEditEnd}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {SHORT.map((field) => (
          <DetailBox
            key={field.key}
            label={field.label}
            value={parts[field.key] ?? ""}
            onChange={set(field.key)}
            onEditEnd={onEditEnd}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 2 }}>
          <DetailBox
            label="Город"
            value={parts.city ?? ""}
            autoCapitalize="words"
            onChange={set("city")}
            onEditEnd={onEditEnd}
          />
        </View>
        <View style={{ flex: 1 }}>
          <DetailBox
            label="Индекс"
            value={parts.zip ?? ""}
            keyboardType="numbers-and-punctuation"
            onChange={set("zip")}
            onEditEnd={onEditEnd}
          />
        </View>
      </View>
      {showPin ? (
        <DetailBox
          label="Ссылка на карту"
          value={pin}
          keyboardType="url"
          autoCapitalize="none"
          onChange={onPinChange}
          onEditEnd={onPinEditEnd}
        />
      ) : null}
    </View>
  );
}

/** Поле точного адреса: подложка, в которой ПОДПИСЬ СТОИТ ВСЕГДА — серая
 *  слева, значение рядом («Этаж 3», «Кв. 5»). Подсказка-плейсхолдер исчезала
 *  вместе с первой цифрой, и «3» с «5» в соседних полях становились
 *  неотличимы. Тап по всей подложке ставит курсор. Данные, а не проза:
 *  автозамена выключена, иначе «12А» уезжало как «12 А». */
function DetailBox({
  label,
  value,
  keyboardType,
  autoCapitalize,
  onChange,
  onEditEnd,
}: {
  label: string;
  value: string;
  keyboardType?: "numbers-and-punctuation" | "url";
  autoCapitalize?: "none" | "words";
  onChange: (next: string) => void;
  onEditEnd?: () => void;
}) {
  const t = useThemeColors();
  const input = useRef<TextInput>(null);
  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        paddingHorizontal: 12,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      {/* Подпись НЕ СЖИМАЕТСЯ: в браузере у поля ввода есть своя «природная»
          ширина, и без этого ужималась подпись — «Под…», «Инде…» на ширине
          телефона (публичная страница /l, STORY-077). Сжимается поле. */}
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{ flexShrink: 0, fontSize: 15, color: t.sub }}
      >
        {label}
      </Text>
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        onBlur={onEditEnd}
        accessibilityLabel={label}
        selectionColor={t.accent}
        keyboardAppearance="light"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={false}
        spellCheck={false}
        maxFontSizeMultiplier={1.2}
        style={{
          flex: 1,
          minWidth: 24,
          paddingVertical: 9,
          padding: 0,
          fontSize: 15,
          color: t.ink,
        }}
      />
    </Pressable>
  );
}
