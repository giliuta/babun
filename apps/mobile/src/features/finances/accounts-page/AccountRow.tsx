import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { EyeOff } from "lucide-react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "../accounts";
import { accountIcon } from "../account-ui";

/** Высота строки: ею `ReorderList` меряет шаг перетаскивания. Та же, что у
 *  строки категории, тега и метки — справочники двигаются одним ритмом. */
export const ACCOUNT_ROW_H = 52;

// СТРОКА СЧЁТА НА СТРАНИЦЕ «СЧЕТА» — КАК СТРОКА УСЛУГИ (владелец 2026-09-15:
// «оно открывается как услуга по сути… влево свайп — скрыть; и можно их
// перетаскивать»). Тот же рецепт, что в прайсе: строка-карточка с заливкой
// цветом счёта, тап — правка, левая кромка — «Скрыть», ручка справа.
//
// ОСТАТОК В СТРОКЕ ЕСТЬ. Раньше его здесь не печатали: те же цифры стояли
// плитками на «Финансах». Но шестерёнка ведёт сюда, минуя панель, и тогда
// другого места увидеть деньги счёта у этой двери нет. Цифра тихая
// (моноширинная, вторым цветом): она справка, а не герой строки; минус — долг.
//
// ПРАВОЙ КРОМКИ НЕТ. Разрушительного у открытого счёта со свайпа не бывает:
// удаление пустого счёта живёт словом в правке, где его видно до нажатия, а
// «Скрыть» никогда не удаляет (`hideDecision`).
//
// Ручка — ВНЕ нажимаемой области, но ВНУТРИ заливки строки: вложенная в
// `Pressable`, она отдавала бы короткий тап правке, а оставленная без цвета —
// светлой полосой выдавала бы себя за отдельную колонку.
export function AccountRow({
  account,
  handle,
  onPress,
  onHide,
}: {
  account: Pick<
    AccountWithBalance,
    "name" | "color" | "icon" | "kind" | "balance"
  >;
  handle: ReactNode;
  onPress: () => void;
  onHide: () => void;
}) {
  const t = useThemeColors();
  const sign = moneySign(account.balance);
  const amount = money(account.balance);
  return (
    <SwipeRow
      // СКРЫТЬ — НА ЛЕВОЙ КРОМКЕ (AGENTS 9, владелец 2026-08-29: «удалить
      // справа, скрыть слева»). Скрытый счёт падает в «Закрытые счета», откуда
      // его открывают тем же жестом.
      leading={{
        label: "Скрыть",
        color: t.warning,
        icon: EyeOff,
        accessibilityLabel: `Скрыть счёт ${account.name}`,
        onAction: onHide,
      }}
    >
      <View
        style={{
          height: ACCOUNT_ROW_H,
          flexDirection: "row",
          alignItems: "stretch",
          backgroundColor: appearanceRowFill(account.color, false, {
            rest: t.surface,
            pressed: t.pressed,
          }),
        }}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${account.name}, ${amount}`}
          accessibilityHint="Открывает правку счёта"
          // Свайпа для VoiceOver не существует — то же действие ротором.
          accessibilityActions={[{ name: "hide", label: "Скрыть" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "hide") onHide();
          }}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 16,
            // Заливку держит вся строка; здесь только отклик на палец, иначе
            // две заливки складывались бы и колонка ручки выходила светлее.
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          {/* Тот же облик, что у плитки на «Финансах»: значка нет или он из
              старого набора (в базе лежат эмодзи) — рисуется глиф вида счёта. */}
          <AppearanceTile
            color={account.color}
            icon={account.icon}
            fallback={accountIcon(account)}
            size={28}
          />
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ flex: 1, marginLeft: 12, fontSize: 16, color: t.ink }}
          >
            {account.name}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{
              marginLeft: 8,
              fontSize: 15,
              // `tabular-nums` классом NativeWind — no-op (ДС §2).
              fontVariant: ["tabular-nums"],
              color: sign < 0 ? t.danger : t.sub,
            }}
          >
            {amount}
          </Text>
        </Pressable>
        <View style={{ justifyContent: "center" }}>{handle}</View>
      </View>
    </SwipeRow>
  );
}
