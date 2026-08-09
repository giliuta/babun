import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  ChevronRight,
  Settings2,
  type LucideIcon,
} from "lucide-react-native";
import { Chip } from "@/components/ui/Chip";
import { sanitizePhoneInput } from "@/lib/phone-input";
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
          // Заголовок раздела: VoiceOver умеет прыгать по заголовкам, а без
          // роли группы карточки читались одним нерасчленимым потоком.
          // Цвет — ПОЛНЫЙ ЧЁРНЫЙ: капс-ярлык это главное слово блока, а не
          // подпись (владелец 2026-07-27: «серым не помечай главные слова»).
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          style={{
            marginBottom: 6,
            marginLeft: 4,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: t.ink,
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
  autoCapitalize,
  autoFocus,
  live,
  multiline,
  valueColor,
  tabular,
  big,
  stacked,
  hideLabel,
  trailing,
  onLabelPress,
  addLabel,
  onEditEnd,
  onType,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  separated?: boolean;
  keyboardType?: "phone-pad" | "email-address" | "url" | "default";
  /** «none» для @username и почты: клавиатура иначе пишет «@Artem_test» с
   *  заглавной, и в данных остаётся искажённый логин. */
  autoCapitalize?: "none" | "sentences" | "words";
  autoFocus?: boolean;
  live?: boolean;
  multiline?: boolean;
  valueColor?: string;
  tabular?: boolean;
  /** Значение крупнее — для имени и телефона (они и есть личность). */
  big?: boolean;
  /** Ярлык НЕ РИСУЕТСЯ над значением (владелец 2026-08-06: «и так понятно,
   *  что это телефон — капсом сверху туповато»). Значение при этом остаётся
   *  подписанным для VoiceOver, а видимая подпись, если она нужна, живёт в
   *  хвосте строки — там, где различают номера. */
  hideLabel?: boolean;
  /** Ярлык СВЕРХУ мелким капсом, значение под ним и ПО ЛЕВОМУ краю.
   *  Так набирают текст: у правого выравнивания курсор стоит у кромки, а
   *  строка растёт влево — печатать в такое поле физически неудобно
   *  (владелец 2026-07-26: «не нравится, что оно справа записывается»). */
  stacked?: boolean;
  trailing?: ReactNode;
  /** Ярлык тоже редактируем (доп. номера: «Жена», «Рабочий»). */
  onLabelPress?: () => void;
  /** Что показать вместо ПОДСКАЗКИ, когда значения нет: «Добавить».
   *  Владелец 2026-07-27: «убери подсказки внутри — есть чёткое добавление».
   *  Инструкция в поле («Домофон 25, зелёная дверь…») читалась как введённый
   *  текст и объясняла то, что и так понятно из ярлыка строки. */
  addLabel?: string;
  /** Правка завершена (blur / Return / уход строки). Вызывающая сторона
   *  использует это, чтобы снять своё локальное состояние. */
  onEditEnd?: () => void;
  /** Каждый символ — БЕЗ записи в базу (в отличие от `live`). Нужен строкам,
   *  у которых хвост зависит от набранного: значок «открыть Telegram» обязан
   *  появиться, пока логин печатают, а не после ухода со строки. */
  onType?: (v: string) => void;
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
          // В РЕЖИМЕ ПРАВКИ контейнер перестаёт быть элементом доступности:
          // иначе он склеивает TextInput внутрь себя, и VoiceOver не может
          // войти в поле — клиента становится нельзя создать вслепую.
          accessible={!editingNow}
          accessibilityRole={editingNow ? "none" : "button"}
          // Запятая, а не двоеточие: VoiceOver даёт паузу, и строка читается
          // «Мобильный, +357 …», а не как «поле: значение».
          accessibilityLabel={value ? `${label}, ${value}` : label}
          accessibilityHint={editingNow ? undefined : "Нажмите, чтобы изменить"}
          // Смена подписи вложена в строку и потому недоступна VoiceOver:
          // отдаём её действием ротора, не разбивая строку на две остановки.
          accessibilityActions={
            onLabelPress ? [{ name: "relabel", label: "Изменить подпись" }] : undefined
          }
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "relabel") onLabelPress?.();
          }}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          {/* Ярлык бывает редактируемым (подпись доп. номера: «Мобильный»,
              «Рабочий») — тогда он нажимается и здесь, иначе перевод строки
              на левое выравнивание отобрал бы смену подписи.

              ВЫГЛЯДИТ ОН ПРИ ЭТОМ ОДИНАКОВО с обычным (владелец 2026-08-02:
              «второй номер должен соответствовать первому — всё стандартное,
              одного размера»). Синий ярлык делал строку доп. номера громче
              основного телефона, хотя это тот же номер того же клиента. */}
          {hideLabel ? null : (() => {
            // ПОДПИСЬ СТРОКИ — ПОЯСНЕНИЕ, А НЕ ЗАГОЛОВОК (владелец 2026-08-06:
            // «сверху написано „телефон", потом „мобильный" — туповато»).
            //
            // Была ровно та же типографика, что у заголовка ГРУППЫ (11/700
            // капс, полный ink) — и четыре номера подряд читались как четыре
            // заголовка разделов: карточка человека выглядела анкетой. Теперь
            // подпись КРУПНЕЕ (13), но тише: обычный регистр, приглушённые
            // чернила. Капс в продукте после этого значит ровно одно —
            // «начало группы».
            //
            // Это уточнение LOCKED-правила 2026-07-27: полный ink остаётся
            // за ИМЕНЕМ ПОЛЯ (заголовки групп), а тип значения («Мобильный»,
            // «Рабочий») — пояснение, и приглушается размером и альфой, а не
            // серым пигментом (t.sub — те же чернила на 74%).
            const labelNode = (
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: t.sub,
                  marginBottom: 2,
                }}
              >
                {label}
              </Text>
            );
            return onLabelPress ? (
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
                {labelNode}
              </Pressable>
            ) : (
              labelNode
            );
          })()}
          {editingNow ? (
            <TextInput
              autoFocus={autoFocus ?? editing}
              value={text}
              onChangeText={(raw) => {
                const v = clean(raw);
                setText(v);
                onType?.(v);
                if (live) onSave(v);
              }}
              onBlur={commit}
              onSubmitEditing={commit}
              // «Готово»/«Назад» живут ВНЕ прокрутки и поле не разфокусируют:
              // без коммита на размонтировании набранное уезжало с экраном.
              blurOnSubmit={!multiline}
              // Пустое поле предлагает ДЕЙСТВИЕ («Добавить»), а не инструкцию:
              // в режиме создания поле открыто для ввода, и без этого строка
              // выглядела просто пустой.
              placeholder={addLabel ?? placeholder}
              placeholderTextColor={addLabel ? t.accent : t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType={keyboardType}
              autoCapitalize={autoCapitalize}
              autoCorrect={autoCapitalize === "none" ? false : undefined}
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
                color: value
                  ? (valueColor ?? t.ink)
                  : addLabel
                    ? t.accent
                    : t.faint,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            >
              {value || addLabel || placeholder}
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
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
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
              onType?.(v);
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
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCapitalize === "none" ? false : undefined}
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
  /** Без обработчика строка становится ПОКАЗАНИЕМ, а не дверью: тот же ритм
   *  и типографика, но без шеврона, нажатия и роли кнопки (лента истории
   *  печатает так заметки — внутрь них проваливаться некуда). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const shown = value || placeholder || "";
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
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
      {onPress ? (
        <ChevronRight
          color={loud ? t.onAccent : t.chevron}
          size={17}
          strokeWidth={2.2}
        />
      ) : null}
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
  size = 32,
  onPress,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  hint?: string;
  /** Диаметр кружка. 32 — хвост строки, 44 — строка списка клиентов. */
  size?: number;
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
        width: size,
        height: size,
        // Круг: w === h. Круг не может стать прямоугольником — это
        // геометрическое исключение из закона одного радиуса.
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${color}1a`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon color={color} size={size >= 40 ? 18 : 16} strokeWidth={2.2} />
    </Pressable>
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

/** Строка ВЫБОРА КНОПКАМИ: капс-ярлык и готовые значения пилюлями + «+», чтобы
 *  создать своё прямо здесь (владелец 2026-07-27: «тип объекта я выбираю
 *  кнопками, чтоб там уже были готовые кнопки и кнопка плюс — типа добавить
 *  своё, сразу можно будет создавать»).
 *
 *  Почему не лист снизу и не текстовое поле: значений три-пять и они короткие,
 *  поэтому выбор — ОДИН тап без экрана поверх экрана. «+» превращается в поле
 *  ввода на месте: новое значение сразу становится выбранным. */
export function ChoiceRow({
  label,
  options,
  value,
  separated,
  onSettings,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  value: string;
  separated?: boolean;
  /** Открыть настройки этого словаря. Владелец 2026-07-27: «не плюсик — а
   *  справа вверху шестерёнка, и там уже идёт редактирование». Свой тип
   *  заводится один раз в настройках бизнеса, а не на бегу в каждой карточке:
   *  иначе у одного бизнеса заводится «Склад», «склад» и «Склады». */
  onSettings?: () => void;
  onSelect: (v: string) => void;
}) {
  const t = useThemeColors();

  return (
    <View
      style={{
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: t.ink,
          }}
        >
          {label}
        </Text>
        {onSettings ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel={`Настроить: ${label.toLowerCase()}`}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Settings2 color={t.ink} size={17} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      {/* rowGap 14, а не общий gap 6: у чипа вертикальный hitSlop 6, поэтому
          при переносе на вторую строку зоны касания СМЫКАЛИСЬ и тап по нижней
          кромке чипа выбирал чип со строки ниже (аудит 2026-07-27). */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          rowGap: 14,
          columnGap: 6,
        }}
      >
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            radio
            selected={
              value.trim().toLowerCase() === option.trim().toLowerCase()
            }
            onPress={() => onSelect(option)}
          />
        ))}
      </View>
    </View>
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
        // Пояснение приглушается РАЗМЕРОМ, а не серостью (закон 2026-07-27).
        fontSize: 12,
        color:
          tone === "danger" ? t.danger : tone === "warning" ? t.warning : t.sub,
      }}
    >
      {text}
    </Text>
  );
}
