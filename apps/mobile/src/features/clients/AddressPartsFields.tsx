import { useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useClientsCapabilities } from "@/session/company-scope";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТОЧНЫЙ АДРЕС — «МИНИ-ДОП» ПОД ГЛАВНОЙ СТРОКОЙ: основное — адрес или ссылка
// на карту, а подробности раскрываются и сворачиваются обратно (слово
// «уточнение» не используем — канцелярит). Главная строка «Адрес или ссылка на карту» живёт в листе и стоит первой;
// здесь — переключатель «Точный адрес» и его поля: улица; подъезд · этаж ·
// квартира; город · индекс. Ссылки на карту среди полей НЕТ: ссылка
// добавляется в главную строку — она и есть адрес или ссылка.
//
// Свёрнутая строка не молчит: справа стоит её содержимое («Sunny Court ·
// подъезд 2 · эт. 3 · кв. 5»), обрезанное с НАЧАЛА — хвост «эт. 3 · кв. 5»
// мастеру нужнее названия комплекса. Все поля `live`: черновик держит лист.

const ADDRESS_DETAILS_LABEL = "Точный адрес";
/** ЧТО ВНУТРИ — СКАЗАНО НА ЗАКРЫТОЙ СТРОКЕ.
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
  /** `link` — маленькая синяя строка внутри карточки адреса. Полноразмерная
   *  строка на 48pt весила бы столько же, сколько сам адрес, хотя это его
   *  уточнение. `row` — полноразмерная строка для публичной страницы, где по
   *  ней тапает клиент с телефона. */
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
}: {
  /** Точный адрес — части без улицы (см. withoutStreet). */
  parts: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Уход с любого поля — момент записи у правки объекта. */
  onEditEnd?: () => void;
}) {
  const set = (key: keyof AddressParts) => (value: string) =>
    onChange({ ...parts, [key]: value });
  // ПОЛЯ-ПОДЛОЖКИ, А НЕ ТАБЛИЦА. Сетка из строк с подписями
  // и линиями между ячейками читалась ведомостью; подложка с подсказкой внутри
  // — тот же язык, что у заметок записи и объекта, и три коротких поля встают
  // в одну строку высотой 40 вместо 60.
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, gap: 10 }}>
      {/* «Улица», а не «Комплекс»: здесь пишут улицу так,
          как её зовут на месте; ссылка на карту — только в главной строке. */}
      <DetailBox
        label="Улица"
        value={parts.complex ?? ""}
        autoCapitalize="words"
        onChange={set("complex")}
        onEditEnd={onEditEnd}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
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
      <View style={{ flexDirection: "row", gap: 10 }}>
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
    </View>
  );
}

/** Поле точного адреса: подпись — подсказкой внутри, а не слева от поля. Тап по всему полю ставит курсор.
 *  Данные, а не проза: автозамена выключена, иначе «12А» уезжало как «12 А». */
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
  // Без выноса: у сотрудника чужой компании части адреса не скопировать.
  const caps = useClientsCapabilities();
  // ПОДПИСЬ — ПОДСКАЗКОЙ ВНУТРИ ПОЛЯ: нажали на «Город» и вписали туда. Поле во всю ширину,
  // подсказка уходит с первой буквой; каждое поле — своя плашка. Заполненное
  // поле держит подпись мелко сверху: иначе «4», «4», «33» в ряд неотличимы.
  const filled = value.trim().length > 0;
  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      style={{
        flex: 1,
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 12,
        paddingVertical: filled ? 5 : 0,
        borderRadius: t.radius.input,
        // Серая плашка — как поле заметки, отдельные плашки с зазором между
        // ними.
        backgroundColor: t.fill,
      }}
    >
      {filled ? (
        <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{ fontSize: 11, color: t.sub }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        onBlur={onEditEnd}
        placeholder={label}
        placeholderTextColor={t.placeholder}
        accessibilityLabel={label}
        contextMenuHidden={!caps.export}
        selectionColor={t.accent}
        keyboardAppearance="light"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={false}
        spellCheck={false}
        maxFontSizeMultiplier={1.2}
        style={{
          paddingVertical: filled ? 0 : 12,
          padding: 0,
          fontSize: 15,
          color: t.ink,
        }}
      />
    </Pressable>
  );
}
