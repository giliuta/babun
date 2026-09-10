import { useEffect, useState } from "react";
import { View } from "react-native";
import { Tag } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { IconPicker } from "@/components/ui/IconPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SELECT_SHEET_RATIO } from "@/components/ui/select-rows";
import { readableTextOnColor } from "@/components/ui/color-contrast";
import { GUTTER } from "@/components/ui/tokens";
import { iconPreset, type IconPreset } from "@/components/ui/icon-set";
import { useThemeColors } from "@/theme/colors";
import { PICKER_RADIUS } from "./picker-grid";

// ВИД СУЩНОСТИ — ОДИН БЛОК НА ВЕСЬ ПРОДУКТ (владелец 2026-09-10: «сделай
// цветовой блок и вставляй его во все, где это может использоваться; точно
// такой же блок с иконками — 40 иконок, то же самое, что цвет; выбор можно
// сделать открытием, и там сразу переключатель — иконка или цвет; компактно,
// красиво, универсально»).
//
// Раньше это были ДВА поля в форме: «Цвет» с плавающей решёткой кружков и
// «Значок» со своей. Они стояли друг под другом, открывались по отдельности и
// занимали в короткой форме половину высоты — при том что отвечают на один
// вопрос: как эта штука будет узнаваться в списке.
//
// Теперь вопрос один: плитка-образец в строке, тап — шторка на полэкрана, в ней
// переключатель и решётка. Сорок цветов и сорок значков живут в одном месте
// (`PRESET_COLORS`, `ICON_PRESETS`), рисуются одной решёткой (`picker-grid`) и
// поэтому везде выглядят одинаково — в календаре, финансах, клиентах, кабинете.
//
// Выбор НЕ ЗАКРЫВАЕТ шторку: у сущности два свойства, и человек обычно ставит
// сразу оба. Закрывает кнопка в футере, вне прокрутки, и слово на ней —
// «Применить» из словаря AGENTS.md: «Готово» и «Сохранить» в этой роли в
// продукте не бывает.

export type AppearanceTab = "icon" | "color";

/** Образец: квадрат цвета сущности, внутри — её значок. Тот же язык, что у
 *  плиток решётки, поэтому строка и шторка читаются как одно целое. */
export function AppearanceTile({
  color,
  icon,
  icons,
  size = 34,
}: {
  color?: string | null;
  icon?: string | null;
  icons?: readonly IconPreset[];
  size?: number;
}) {
  const t = useThemeColors();
  const fill = color ?? t.fill;
  const Glyph = icons
    ? icons.find((i) => i.value === icon)?.icon ?? null
    : iconPreset(icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: PICKER_RADIUS,
        borderCurve: "continuous",
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* ПУСТОЙ ВИД ГОВОРИТ, ЧТО ОН ПУСТОЙ. Квадрат без цвета и без значка
          читался серой дырой в списке, будто строка не догрузилась; тихий
          ярлычок вместо него означает «вид не выбран» — то же слово, каким
          пустоту показывает блок категории. */}
      {Glyph ? (
        <Glyph
          size={Math.round(size * 0.56)}
          strokeWidth={2}
          color={color ? readableTextOnColor(color, t.ink, "#FFFFFF") : t.body}
        />
      ) : color ? null : (
        <Tag size={Math.round(size * 0.5)} strokeWidth={2} color={t.faint} />
      )}
    </View>
  );
}

export function AppearanceSheet({
  visible,
  onClose,
  title = "Вид",
  color,
  onColorChange,
  colors,
  icon,
  onIconChange,
  icons,
  initial = "color",
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  color: string | null | undefined;
  onColorChange: (hex: string) => void;
  /** Палитра-переопределение; по умолчанию общие сорок. */
  colors?: readonly string[];
  /** Значок сущности. Без `onIconChange` шторка спрашивает только про цвет —
   *  так у сущностей, у которых значка нет (метка города, тег клиента). */
  icon?: string | null;
  onIconChange?: (slug: string) => void;
  icons?: readonly IconPreset[];
  initial?: AppearanceTab;
}) {
  const withIcon = Boolean(onIconChange);
  const [tab, setTab] = useState<AppearanceTab>(withIcon ? initial : "color");

  // Открывается всегда на той вкладке, ради которой позвали: тап по значку в
  // строке — «Значок», тап по цвету — «Цвет». Иначе человек каждый раз
  // переключает вкладку сам, а это лишний тап на каждое открытие.
  useEffect(() => {
    if (visible) setTab(withIcon ? initial : "color");
  }, [visible, initial, withIcon]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 12 }}>
        {withIcon ? (
          <SegmentedControl
            options={[
              { value: "icon" as const, label: "Значок" },
              { value: "color" as const, label: "Цвет" },
            ]}
            value={tab}
            onChange={setTab}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {tab === "color" ? (
          <ColorPicker value={color} onChange={onColorChange} colors={colors} />
        ) : (
          <IconPicker
            value={icon}
            onChange={onIconChange ?? (() => {})}
            tint={color}
            icons={icons}
          />
        )}
      </View>
    </BottomSheet>
  );
}

export default AppearanceSheet;
