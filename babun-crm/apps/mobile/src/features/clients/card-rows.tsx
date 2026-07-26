import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { sanitizePhoneInput } from "@/features/clients/phone";
import { useThemeColors } from "@/theme/colors";

// ЕДИНАЯ СТРОКА КАРТОЧКИ КЛИЕНТА — тот же диалект, что у строк фильтров:
// «ярлык слева … значение справа», 48pt, тап = правка на месте. Владелец
// 2026-07-26: «разделить чётко — имя, номер телефона, объекты и так
// далее, всё зафиксировано в своём блоке и всегда можно редактировать».
//
// Почему строки, а не «постер»: раньше имя было крупным заголовком, а
// телефон — мелкой строкой под ним, и на экране создания это читалось
// перевёрнуто (заголовок «Имя», а курсор в номере). Строка с ярлыком
// снимает вопрос «что это за поле» в обоих режимах сразу.

export function RowGroup({
  title,
  children,
}: {
  /** Капс-надпись над группой; без неё группа безымянная. */
  title?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View style={{ marginHorizontal: 12, marginTop: 12 }}>
      {title ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginBottom: 6,
            marginLeft: 4,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: t.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Строка-факт: ярлык · значение · опциональный хвост. Тап по значению
 *  открывает правку на месте (сохранение по blur, как в остальной
 *  карточке). `live` — режим черновика: пишем на каждый символ, потому что
 *  «Готово» читает черновик из текущего замыкания и blur не успел бы. */
export function FieldRow({
  label,
  value,
  placeholder,
  separated,
  keyboardType,
  autoFocus,
  live,
  multiline,
  valueColor,
  tabular,
  big,
  stacked,
  trailing,
  onLabelPress,
  onEditEnd,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  separated?: boolean;
  keyboardType?: "phone-pad" | "email-address" | "url" | "default";
  autoFocus?: boolean;
  live?: boolean;
  multiline?: boolean;
  valueColor?: string;
  tabular?: boolean;
  /** Значение крупнее — для имени и телефона (они и есть личность). */
  big?: boolean;
  /** Ярлык СВЕРХУ мелким капсом, значение под ним и ПО ЛЕВОМУ краю.
   *  Так набирают текст: у правого выравнивания курсор стоит у кромки, а
   *  строка растёт влево — печатать в такое поле физически неудобно
   *  (владелец 2026-07-26: «не нравится, что оно справа записывается»). */
  stacked?: boolean;
  trailing?: ReactNode;
  /** Ярлык тоже редактируем (доп. номера: «Жена», «Рабочий»). */
  onLabelPress?: () => void;
  /** Правка завершена (blur / Return / уход строки). Вызывающая сторона
   *  использует это, чтобы снять своё локальное состояние. */
  onEditEnd?: () => void;
  onSave: (v: string) => void;
}) {
  const t = useThemeColors();
  // autoFocus означает «начинай с ввода»: без этого строка рисовалась
  // текстом-заглушкой, TextInput не монтировался вовсе, и по «+ Добавить
  // номер» приходилось тапать по полю ВТОРОЙ раз, чтобы появилась
  // клавиатура.
  const [editing, setEditing] = useState(!!autoFocus);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  const editingNow = editing || !!live;
  const valueSize = big ? 17 : 15;
  // Буквы в номер не попадают НИ ОДНИМ путём — ни вставкой, ни диктовкой,
  // ни внешней клавиатурой. Чистка живёт в примитиве, а не в каждом вызове:
  // забыть её на новой строке-номере невозможно.
  const clean = (v: string) =>
    keyboardType === "phone-pad" ? sanitizePhoneInput(v) : v;

  // Коммит значения. Единственная точка: blur, Return и размонтирование
  // строки. Раньше коммит был только в onBlur, а кнопки «Готово» и «Назад»
  // живут вне прокрутки и фокус не снимают — уход с экрана с открытой
  // клавиатурой стирал всё набранное.
  const latest = useRef({ text, value, live: !!live, onSave, onEditEnd });
  latest.current = { text, value, live: !!live, onSave, onEditEnd };
  const commit = () => {
    setEditing(false);
    const cur = latest.current;
    if (!cur.live && cur.text.trim() !== cur.value) cur.onSave(cur.text.trim());
    cur.onEditEnd?.();
  };
  useEffect(
    () => () => {
      const cur = latest.current;
      if (!cur.live && cur.text.trim() !== cur.value) {
        cur.onSave(cur.text.trim());
      }
    },
    [],
  );

  if (stacked) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 60,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderTopWidth: separated ? 1 : 0,
          borderTopColor: t.separator,
        }}
      >
        {/* Нажимается ВСЯ левая колонка, а не только текст значения: строка
            60pt, а правка открывалась лишь прицельным попаданием в буквы —
            капс-ярлык и пустота справа от короткого значения были мёртвыми,
            хотя правка поля — самое частое действие на странице. Хвост
            (кнопка связи, ✕) остаётся СНАРУЖИ: вложенный в нажимаемую
            область он склеивается со строкой для VoiceOver. */}
        <Pressable
          onPress={editingNow ? undefined : () => setEditing(true)}
          disabled={editingNow}
          accessibilityRole={editingNow ? "none" : "button"}
          accessibilityLabel={value ? `${label}: ${value}` : label}
          accessibilityHint={editingNow ? undefined : "Нажмите, чтобы изменить"}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          {/* Ярлык бывает редактируемым (подпись доп. номера: «Второй»,
              «Супруг(а)») — тогда он нажимается и здесь, иначе перевод
              строки на левое выравнивание отобрал бы смену подписи. */}
          {onLabelPress ? (
            <Pressable
              onPress={onLabelPress}
              accessibilityRole="button"
              accessibilityLabel={`Подпись номера: ${label}`}
              accessibilityHint="Нажмите, чтобы изменить подпись"
              hitSlop={{ top: 8, bottom: 4, left: 8, right: 8 }}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: t.accent,
                  marginBottom: 2,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ) : (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: t.faint,
                marginBottom: 2,
              }}
            >
              {label}
            </Text>
          )}
          {editingNow ? (
            <TextInput
              autoFocus={autoFocus ?? editing}
              value={text}
              onChangeText={(raw) => {
                const v = clean(raw);
                setText(v);
                if (live) onSave(v);
              }}
              onBlur={commit}
              onSubmitEditing={commit}
              // «Готово»/«Назад» живут ВНЕ прокрутки и поле не разфокусируют:
              // без коммита на размонтировании набранное уезжало с экраном.
              blurOnSubmit={!multiline}
              placeholder={placeholder}
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType={keyboardType}
              multiline={multiline}
              accessibilityLabel={label}
              maxFontSizeMultiplier={1.2}
              style={{
                padding: 0,
                fontSize: valueSize,
                fontWeight: "600",
                color: t.ink,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            />
          ) : (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={multiline ? 3 : 1}
              style={{
                fontSize: valueSize,
                fontWeight: "600",
                color: value ? (valueColor ?? t.ink) : t.faint,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            >
              {value || placeholder}
            </Text>
          )}
        </Pressable>
        {trailing}
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 12,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {onLabelPress ? (
        <Pressable
          onPress={onLabelPress}
          accessibilityRole="button"
          accessibilityLabel={`Подпись номера: ${label}`}
          accessibilityHint="Нажмите, чтобы изменить подпись"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "600", color: t.sub }}
          >
            {label}
          </Text>
        </Pressable>
      ) : (
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {label}
        </Text>
      )}

      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {editingNow ? (
          <TextInput
            autoFocus={autoFocus ?? editing}
            value={text}
            onChangeText={(raw) => {
              const v = clean(raw);
              setText(v);
              if (live) onSave(v);
            }}
            onBlur={commit}
            onSubmitEditing={commit}
            blurOnSubmit={!multiline}
            placeholder={placeholder}
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType={keyboardType}
            multiline={multiline}
            accessibilityLabel={label}
            maxFontSizeMultiplier={1.2}
            style={{
              alignSelf: "stretch",
              textAlign: "right",
              fontSize: 15,
              fontWeight: "500",
              color: t.ink,
              paddingVertical: 4,
              fontVariant: tabular ? ["tabular-nums"] : undefined,
            }}
          />
        ) : (
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel={value ? `${label}: ${value}` : label}
            accessibilityHint="Нажмите, чтобы изменить"
            hitSlop={{ top: 10, bottom: 10, left: 10 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={multiline ? 3 : 1}
              style={{
                textAlign: "right",
                fontSize: 15,
                fontWeight: "500",
                color: value ? (valueColor ?? t.ink) : t.faint,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            >
              {value || placeholder}
            </Text>
          </Pressable>
        )}
      </View>

      {trailing}
    </View>
  );
}

/** Строка-дверь: ярлык · значение · шеврон. Шеврон — единственный признак,
 *  отличающий «уводит» от «правится на месте», когда обе строки выглядят
 *  одинаково. `loud` — единственная громкая поверхность экрана («Записать»). */
export function NavRow({
  label,
  value,
  placeholder,
  valueColor,
  separated,
  loud,
  dimmed,
  onPress,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  valueColor?: string;
  separated?: boolean;
  loud?: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const shown = value || placeholder || "";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={shown ? `${label}: ${shown}` : label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: loud ? 52 : 48,
        paddingHorizontal: 16,
        gap: 12,
        opacity: dimmed ? 0.5 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: loud
          ? t.accent
          : pressed
            ? t.pressed
            : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        // Ярлык уступает место значению: адрес объекта длиннее подписи
        // «Дом», и без сжатия ярлык забирал бы ширину у того, ради чего
        // строку и открывают.
        style={{
          flexShrink: 1,
          fontSize: loud ? 17 : 15,
          fontWeight: "600",
          color: loud ? t.onAccent : t.ink,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {shown ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: loud
                ? t.onAccent
                : value
                  ? (valueColor ?? t.ink)
                  : t.faint,
            }}
          >
            {shown}
          </Text>
        ) : null}
      </View>
      <ChevronRight
        color={loud ? t.onAccent : t.chevron}
        size={17}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

/** Кнопка в ХВОСТЕ строки — действие над самим значением этой строки:
 *  связаться с этим номером, проложить маршрут к этому адресу. Владелец
 *  2026-07-26: «с правой стороны нажимаешь кнопку и выбираешь, что делать».
 *
 *  32pt кружок: меньше цели касания 44pt по кругу, поэтому hitSlop
 *  добирает остальное — иначе палец бьёт по строке и уводит со экрана. */
export function RowActionButton({
  icon: Icon,
  color,
  label,
  hint,
  onPress,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${color}1a`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon color={color} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}

/** Ряд-действие внутри группы («+ Добавить номер»). Строго про добавление —
 *  для действий над самой сущностью есть ActionRow. */
export function AddRow({
  label,
  separated,
  dimmed,
  onPress,
}: {
  label: string;
  separated?: boolean;
  /** Добавлять пока нельзя (в черновике — до имени и телефона). */
  dimmed?: boolean;
  onPress: () => void;
}) {
  return (
    <ActionRow
      label={label}
      separated={separated}
      dimmed={dimmed}
      onPress={onPress}
    />
  );
}

/** Ряд-действие над сущностью: «Сделать основным», «Удалить объект».
 *  Отличается от AddRow только смыслом (и тоном), поэтому вёрстка общая, а
 *  примитивы разные: «+ Добавить …» и «Удалить …» — не одно и то же, и
 *  закон строки требует различать их по имени, а не по цвету. */
export function ActionRow({
  label,
  tone = "accent",
  separated,
  dimmed,
  onPress,
}: {
  label: string;
  tone?: "accent" | "danger";
  separated?: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={dimmed ? undefined : onPress}
      disabled={dimmed}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!dimmed }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        opacity: dimmed ? 0.4 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: tone === "danger" ? t.danger : t.accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Строка с ГОТОВЫМ КОНТРОЛОМ в хвосте: ярлык слева, нативный контрол
 *  справа (дата ТО). Не FieldRow: значение здесь не текст, и тап по нему
 *  должен открывать системный пикер, а не клавиатуру. */
export function ControlRow({
  label,
  separated,
  children,
}: {
  label: string;
  separated?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        gap: 12,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>{children}</View>
    </View>
  );
}

/** Тихая подпись ПОД группой — то, что объясняет группу, но не является её
 *  строкой: «7 визитов · посл. 14 апр», «Следующее ТО через 63 дн». Тон
 *  несёт смысл: обычное серым, «скоро» янтарём, «просрочено» красным. */
export function RowCaption({
  text,
  tone = "quiet",
}: {
  text: string;
  tone?: "quiet" | "warning" | "danger";
}) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{
        marginHorizontal: 16,
        marginTop: 6,
        fontSize: 13,
        color:
          tone === "danger" ? t.danger : tone === "warning" ? t.warning : t.sub,
      }}
    >
      {text}
    </Text>
  );
}
