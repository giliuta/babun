import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { useThemeColors } from "@/theme/colors";

// СТРОКА СВЯЗАННОГО КЛИЕНТА (STORY-085, вариант 3 владельца 2026-09-21: «все —
// клиенты, связаны друг с другом»).
//
// Одна строка на три места: «Люди» на карточке (кто входит в этого клиента),
// «Входит в» у самого человека и «Жильцы» в листе объекта. Везде это ДРУГОЙ
// клиент со своей карточкой: тап по имени открывает её, кнопка справа звонит.
//
// РОЛЬ ПИШЕТСЯ ПРЯМО В СТРОКЕ (владелец 2026-09-21: «роль… вручную вписываем…
// без чипов… не надо делать лишние этапы»). Вторая строка — поле: тап ставит
// курсор, «Готово» на клавиатуре или уход со строки сохраняют. Пустая роль —
// законное значение: подсказка «Роль» называет поле, а не требует его.
//
// БЕЗ АВАТАРА (владелец 22.09: «я бы вообще убрал аватар, он не нужен»):
// строка — имя, место, роль и звонок; узнаётся человек по имени.

/** Связи, чья строка ушла НЕ по правке, а потому что связь УБРАЛИ.
 *
 *  Без этого списка коммит роли на размонтировании воскрешал бы убранную
 *  связь: убрали → патч без связи → строка размонтировалась → отложенный
 *  коммит записал её обратно. Ровно этот класс тихих записей уже описан у
 *  `FieldRow` (`card-rows.tsx:370-385`).
 *
 *  Правило живёт в примитиве, а не в каждом перечне, — тем же приёмом, что
 *  «открытый ряд ровно один» (`closeOpenRow`, `SwipeRow.tsx:57-59`): строк
 *  связей на экране несколько, а закон у них один. */
const removedLinks = new Set<string>();

/** Сказать строке связи `key`, что она сейчас исчезнет из-за удаления.
 *  Зовётся перечнем ПЕРЕД самим удалением (см. `ClientLinkRows`). */
export function suppressRoleCommit(key: string): void {
  removedLinks.add(key);
}

/** ПИШЕТСЯ ЛИ РОЛЬ ПРИ УХОДЕ СТРОКИ. Три условия, и каждое — отдельный
 *  случай из жизни:
 *
 *  • `linkKey` — коммит на размонтировании ПРАВИТ существующую связь и
 *    никогда не заводит новую: без ключа связи править нечего;
 *  • `removed` — связь убрали, патч без неё уже ушёл, и запись роли
 *    воскресила бы её;
 *  • `edited` — поле не трогали, писать нечего; иначе каждый уход со
 *    страницы стоил бы запроса и перерисовки перечня.
 *
 *  Вынесено из эффекта чистой функцией НАМЕРЕННО: гонка «убрали → коммит
 *  воскресил» происходит внутри одного кадра, снимок её не ловит, и
 *  единственное доказательство здесь — сторож с мутантом. */
export function shouldCommitRoleOnUnmount({
  linkKey,
  edited,
  removed,
}: {
  linkKey?: string;
  edited: boolean;
  removed: boolean;
}): boolean {
  if (!linkKey) return false;
  if (removed) return false;
  return edited;
}

export function LinkRow({
  name,
  place,
  phone,
  telegramUsername,
  role,
  rolePlaceholder = "Роль",
  separated,
  autoFocusRole,
  compact = false,
  linkKey,
  onOpen,
  onRoleChange,
}: {
  /** Имя связанного клиента. */
  name: string;
  /** Где именно: объект жильца («Вилла 5»). Тише имени, той же строкой. */
  place?: string;
  phone?: string | null;
  telegramUsername?: string | null;
  role: string;
  rolePlaceholder?: string;
  separated?: boolean;
  /** Строку только что добавили — курсор сразу в роль. */
  autoFocusRole?: boolean;
  /** ОДНОЙ СТРОКОЙ — «Екатерина · жена» (владелец 2026-09-21: люди живут в
   *  первом блоке карточки рядом с номерами, и строка должна быть той же
   *  высоты, что строки номеров, а не карточкой в две строки). */
  compact?: boolean;
  /** Ключ САМОЙ СВЯЗИ (не клиента: один человек бывает жильцом двух вилл
   *  одной управляющей). Нужен коммиту роли на размонтировании: без ключа
   *  строка не знает, какую связь правит, и отложенный коммит не пишется
   *  вовсе — он ПРАВИТ существующую связь и никогда не заводит новую. */
  linkKey?: string;
  /** Открыть карточку этого клиента. */
  onOpen: () => void;
  /** Нет — роль только читается (нет права менять контакты). */
  onRoleChange?: (role: string) => void;
}) {
  const t = useThemeColors();
  const [value, setValue] = useState(role);
  // Роль сменили снаружи (правка со второй стороны связи, ответ сервера) —
  // поле догоняет, но только пока его не правят руками.
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setValue(role);
  }, [role]);
  // Выход из правки ОДИН — `onEndEditing`: «Готово» на клавиатуре тоже
  // снимает фокус и приходит сюда же, а второй обработчик на submit писал бы
  // роль дважды. Размонтирование зовёт этот же коммит (ниже), но только пока
  // правка не доехала: сам он идемпотентен — совпавшее значение не пишется.
  const commit = () => {
    editing.current = false;
    const next = value.trim();
    if (next === role.trim()) {
      setValue(role);
      return;
    }
    onRoleChange?.(next);
  };
  // КОММИТ И НА РАЗМОНТИРОВАНИИ (образец — `pendingRef` в
  // `ClientExtraContacts.tsx:115-121`): `onEndEditing` не приходит, когда
  // строка уезжает вместе с экраном — тап по имени уводит на чужую карточку
  // прямо посреди набранного слова, и роль терялась молча.
  //
  // Размонтирование читает замыкание ПРОШЛОГО рендера, поэтому актуальный
  // коммит держим в ref.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    // Строка появилась (в том числе вернулась после отката неудачного
    // «Убрать») — старая метка удаления на ней больше не висит.
    if (linkKey) removedLinks.delete(linkKey);
    return () => {
      // Метку удаления снимаем ВСЕГДА — иначе она осталась бы висеть на
      // ключе и проглотила бы следующий честный коммит той же связи.
      const removed = !!linkKey && removedLinks.delete(linkKey);
      if (!shouldCommitRoleOnUnmount({ linkKey, edited: editing.current, removed }))
        return;
      commitRef.current();
    };
  }, [linkKey]);
  const title = name.trim() || "Без имени";

  const roleInput = (
    <TextInput
      keyboardAppearance="light"
      accessibilityLabel={`Роль: ${title}`}
      value={value}
      onFocus={() => {
        editing.current = true;
      }}
      onChangeText={(next) => {
        editing.current = true;
        setValue(next);
      }}
      onEndEditing={commit}
      placeholder={rolePlaceholder}
      placeholderTextColor={t.placeholder}
      selectionColor={t.accent}
      autoFocus={autoFocusRole}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      maxFontSizeMultiplier={1.2}
      style={
        compact
          ? {
              flex: 1,
              minWidth: 56,
              fontSize: 15,
              color: t.sub,
              paddingVertical: 8,
              paddingHorizontal: 0,
            }
          : {
              fontSize: 13,
              color: t.sub,
              paddingVertical: 3,
              paddingHorizontal: 0,
            }
      }
    />
  );

  if (compact) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 16,
          paddingRight: 12,
          paddingVertical: 4,
          minHeight: 48,
          borderTopWidth: separated ? 1 : 0,
          borderTopColor: t.separator,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {/* АВАТАРА НЕТ (владелец 22.09: «я бы вообще убрал аватар, он не
              нужен»). Кружок с инициалами повторял имя, стоящее рядом, и
              делал четыре строки людей похожими на ленту чата. Дверь в
              карточку человека теперь — само имя. */}
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={[title, place, role].filter(Boolean).join(", ")}
            accessibilityHint="Открывает карточку клиента"
            hitSlop={{ left: 8 }}
            // Имя — дверь во всю высоту строки, а не по тексту (аудит 22.09
            // мерил 36 точек).
            style={({ pressed }) => ({
              flexShrink: 1,
              alignSelf: "stretch",
              justifyContent: "center",
              minHeight: 44,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {title}
              {place ? (
                <Text style={{ fontWeight: "400", color: t.faint }}>
                  {` · ${place}`}
                </Text>
              ) : null}
            </Text>
          </Pressable>
          {/* Роль только читается и пуста — нет ни поля, ни слова: точка
              повисла бы после имени пустым хвостом «Андреас · ». */}
          {onRoleChange || role.trim() ? (
            <>
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 15, color: t.faint }}
              >
                {" · "}
              </Text>
              {onRoleChange ? (
                roleInput
              ) : (
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                  style={{ flex: 1, fontSize: 15, color: t.sub }}
                >
                  {role}
                </Text>
              )}
            </>
          ) : null}
        </View>
        {phone ? (
          <PhoneChannelButton
            number={phone}
            telegramUsername={telegramUsername}
            label={title}
            smsName={name}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 8,
        minHeight: 56,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Имя — дверь в карточку человека (аватара нет, владелец 22.09). */}
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={[title, place, role].filter(Boolean).join(", ")}
          accessibilityHint="Открывает карточку клиента"
          // ЦЕЛЬ ДОБИРАЕТСЯ ВВЕРХ И В СТОРОНЫ, НО НЕ ВНИЗ: строка имени сама
          // по себе ~18pt, а под ней стоит поле роли. Слоп вниз забирал бы
          // тапы у роли — и вместо курсора в слове открывалась бы чужая
          // карточка (тот же промах, что у крестика номеров, аудит
          // 2026-07-27).
          hitSlop={{ top: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            {title}
            {place ? (
              <Text style={{ fontWeight: "400", color: t.faint }}>
                {` · ${place}`}
              </Text>
            ) : null}
          </Text>
        </Pressable>
        {onRoleChange ? (
          roleInput
        ) : role ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 13, color: t.sub, marginTop: 2 }}
          >
            {role}
          </Text>
        ) : null}
      </View>

      {phone ? (
        <PhoneChannelButton
          number={phone}
          telegramUsername={telegramUsername}
          label={title}
          smsName={name}
        />
      ) : null}
    </View>
  );
}
