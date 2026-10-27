import { Pressable, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import { FieldLabel } from "@/components/ui/Field";
import { GUTTER } from "@/components/ui/tokens";
import { NameColorField } from "@/components/ui/picker-fields";
import { useThemeColors } from "@/theme/colors";
import type { ServiceSheetState } from "./use-service-sheet";

/** Name with appearance, plus the optional invoice description. */
export function ServiceNameBlock({ sheet }: { sheet: ServiceSheetState }) {
  const t = useThemeColors();
  const {
    service,
    name,
    setName,
    color,
    setColor,
    icon,
    setIcon,
    hasDescription,
    setHasDescription,
    description,
    setDescription,
    setOpenRow,
  } = sheet;
  return (
    <>
      {/* ИМЯ — ОНО ЖЕ ИМЯ В СЧЁТЕ. Второго имени «для документов» у услуги
          нет и не будет: его заводили дважды («Название в счёте», «Имя для
          клиента»), оба раза не заполнил никто, и оба раза владелец не понял
          строку. Подпись честно называет последствие — а формулировку для
          конкретного счёта правят в самом счёте, где она и замерзает. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        {/* ВИД — ОБЩИЙ БЛОК «ВИД»: строка справочника ЗАЛИВАЕТСЯ цветом
            услуги, как строка выбора, и рядом стоит её значок. */}
        <NameColorField
          label="Название"
          placeholder="Название услуги"
          name={name}
          onNameChange={setName}
          color={color}
          onColorChange={setColor}
          icon={icon}
          onIconChange={setIcon}
          autoFocus={!service}
          // «＋ Описание» стоит у ПОДПИСИ. Под полем кнопка читалась бы как
          // продолжение самого поля и отодвигала цену; у ярлыка она читается
          // как то, чем она является, — необязательной припиской к имени.
          labelAction={
            hasDescription ? undefined : (
              <Pressable
                onPress={() => {
                  setOpenRow(null);
                  setHasDescription(true);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Добавить описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  paddingLeft: 12,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 14, fontWeight: "500", color: t.accent }}
                >
                  ＋ Описание
                </Text>
              </Pressable>
            )
          }
        />

        {/* ОПИСАНИЕ ЖИВЁТ ПРИ ИМЕНИ, А НЕ ОТДЕЛЬНОЙ КАРТОЧКОЙ (владелец
            2026-08-21: «это должна быть маленькая кнопочка добавить описание
            под самим названием, типа плюсик»). Оно описывает именно ИМЯ, и
            карточка во всю ширину обещала блок там, где нужна приписка.
            Пустое — маленькая накладка в одну строку; заведённое — такое же
            поле, как имя, только в три строки высотой.
            ДОХОДИТ ДО КЛИЕНТА: текст печатается второй строкой ПОД названием
            позиции в счёте и в PDF. */}
        {hasDescription ? (
          <View style={{ marginTop: -6, marginBottom: 16 }}>
            {/* ДВЕРЬ ОТКРЫВАЕТСЯ В ОБЕ СТОРОНЫ. Если `hasDescription` обратно не
                снимается, то тапнул «＋ Описание» по ошибке — и блок остаётся до
                закрытия листа. Крестик убирает и блок, и текст: снятое описание
                уезжает в базу явным `null`, об этом заботится `submit`. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <FieldLabel text="Описание в счёте" />
              <Pressable
                onPress={() => {
                  setHasDescription(false);
                  setDescription("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Убрать описание"
                style={({ pressed }) => ({
                  paddingBottom: 6,
                  opacity: pressed ? 0.4 : 1,
                })}
              >
                <X color={t.faint} size={16} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              autoFocus={!description}
              accessibilityLabel="Описание в счёте"
              selectionColor={t.accent}
              keyboardAppearance="light"
              style={{
                minHeight: 76,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: t.radius.input,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: t.separator,
                fontSize: 16,
                lineHeight: 22,
                color: t.ink,
                textAlignVertical: "top",
              }}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}
