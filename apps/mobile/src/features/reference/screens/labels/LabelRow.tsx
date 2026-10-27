import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { AppearanceTile, appearanceRowFill } from "@/components/ui/AppearanceSheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import type { City } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import { FALLBACK_COLOR, ROW_H } from "./label-rules";

/** One label row of `LabelsScreen`: swipe edges, tile, name and drag handle. */
export function LabelRow({
  city,
  handle,
  readOnly,
  onEdit,
  onRemove,
  onLeading,
}: {
  city: City;
  /** Drag handle from `ReorderList`. */
  handle: ReactNode;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
  /** Left edge: hide, show or restore — whichever the row's state calls for. */
  onLeading: () => void;
}) {
  const t = useThemeColors();
  const deleted = !!city.deleted_at;
  const hidden = !city.is_active && !deleted;
  return (
    <SwipeRow
      label={readOnly ? undefined : "Удалить"}
      color={t.danger}
      icon={Trash2}
      accessibilityLabel={`Удалить метку ${city.name}`}
      onAction={readOnly ? undefined : onRemove}
      // СЛЕВА — «СКРЫТЬ», КАК У УСЛУГ. «Основной» метки (фолбэк на все дни всех
      // команд) нет: то же выражается недельным расписанием («по вторникам —
      // Греция»), где видно, ЧТО и КОГДА.
      //
      // Стороны те же, что у услуг: справа «Удалить», слева
      // «Скрыть». Разрушительное действие на постоянном месте.
      // ТРИ СОСТОЯНИЯ СТРОКИ — ТРИ РАЗНЫХ ЛЕВЫХ ДЕЙСТВИЯ:
      //   живая    → «Скрыть»   (перестаёт предлагаться);
      //   скрытая  → «Показать» (возвращается в выбор);
      //   удалённая→ «Вернуть»  (снимается пометка на удаление).
      // Подпись обязана называть то, что произойдёт: «Скрыть» у удалённой
      // по нажатию возвращала бы её.
      leading={readOnly ? undefined : {
        label: deleted
          ? "Вернуть"
          : hidden
            ? "Показать"
            : "Скрыть",
        color: deleted || hidden ? t.success : t.warning,
        icon: deleted || hidden ? RotateCcw : EyeOff,
        accessibilityLabel: deleted
          ? `Вернуть удалённую метку ${city.name}`
          : hidden
            ? `Показать метку ${city.name}`
            : `Скрыть метку ${city.name}`,
        onAction: onLeading,
      }}
    >
      {/* Содержимое кромки — РЯД: сама строка тянется, ручка едет
          вместе с ней. Без явного направления `SwipeRow` сложил бы
          их столбиком и удвоил высоту строки. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          // Скрытая не исчезает и не кричит — просто тише живых.
          opacity: deleted ? 0.3 : hidden ? 0.45 : 1,
          backgroundColor: appearanceRowFill(city.color, false, {
            rest: t.surface,
            pressed: t.pressed,
          }),
        }}
      >
        <Pressable
          disabled={readOnly}
          onPress={onEdit}
          accessibilityRole={readOnly ? "text" : "button"}
          accessibilityLabel={readOnly ? `Метка ${city.name}` : `Метка ${city.name}, редактировать`}
          style={({ pressed }) => ({
            flex: 1,
            height: ROW_H,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 16,
            // Заливку держит вся строка (см. выше); здесь остаётся
            // только отклик на палец.
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          {/* ПЛИТКА ВИДА — как у тега, категории, услуги и типа
              объекта. Точка 12pt была единственным пятном цвета в
              продукте, которое не умеет показать значок. */}
          <AppearanceTile
            color={city.color ?? FALLBACK_COLOR}
            size={28}
          />
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              marginLeft: 12,
              fontSize: 16,
              color: t.ink,
            }}
          >
            {city.name}
          </Text>
          <View style={{ flex: 1, minWidth: 8 }} />
        </Pressable>
        {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь, она
            отдавала бы короткий тап строке и открывала редактор
            вместо перетаскивания. */}
        {handle}
      </View>
    </SwipeRow>
  );
}
