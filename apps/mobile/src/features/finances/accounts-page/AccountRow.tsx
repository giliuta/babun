import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
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
// ПРАВАЯ КРОМКА — «УДАЛИТЬ» У КАЖДОГО СЧЁТА (владелец 03.10: «свайпом
// удалять, они попадают в папку „Удалённые счета" на 30 дней, как клиенты»).
// Удаление обратимо: счёт уходит в «Удалённые счета», откуда возвращается.
//
// ЗАКРЫТЫЙ СЧЁТ — ТА ЖЕ СТРОКА, СЕРАЯ, ВНИЗУ СВОЕЙ КОМАНДЫ (владелец
// 2026-09-29: «убери вкладку „Закрытые счета“»). Как скрытая категория: слева
// «Открыть», справа — то же «Удалить».
//
// Ручка — ВНЕ нажимаемой области, но ВНУТРИ заливки строки: вложенная в
// `Pressable`, она отдавала бы короткий тап правке, а оставленная без цвета —
// светлой полосой выдавала бы себя за отдельную колонку.
export function AccountRow({
  account,
  mark,
  sub,
  handle,
  onPress,
  onHide,
  onDelete,
  closed,
}: {
  account: Pick<
    AccountWithBalance,
    "name" | "color" | "icon" | "kind" | "balance"
  >;
  /** Тихое слово перед суммой (`accountRowMark`): «Основной», «Не в оплате».
   *  Место ему уступает имя (единственная тянущаяся колонка строки): длинное
   *  имя сжимается до многоточия, а метка и сумма остаются целы. */
  mark?: string | null;
  /** Тихая строка под именем. Две строки 16 + 13 pt укладываются в те же
   *  52 pt — шаг перетаскивания не меняется. */
  sub?: string | null;
  handle: ReactNode;
  onPress: () => void;
  onHide: () => void;
  /** «Удалить» — в «Удалённые счета». */
  onDelete: () => void;
  /** Счёт закрыт: строка гаснет, слева «Открыть». */
  closed?: { onReopen: () => void } | null;
}) {
  const t = useThemeColors();
  const sign = moneySign(account.balance);
  const amount = money(account.balance);
  return (
    <SwipeRow
      // СКРЫТЬ — НА ЛЕВОЙ КРОМКЕ (AGENTS 9, владелец 2026-08-29: «удалить
      // справа, скрыть слева»). Скрытый счёт падает вниз своей команды серым,
      // и там же тем же жестом открывается снова.
      leading={
        closed
          ? {
              label: "Открыть",
              color: t.success,
              icon: RotateCcw,
              accessibilityLabel: `Открыть счёт ${account.name} снова`,
              onAction: closed.onReopen,
            }
          : {
              label: "Скрыть",
              color: t.warning,
              icon: EyeOff,
              accessibilityLabel: `Скрыть счёт ${account.name}`,
              onAction: onHide,
            }
      }
      label="Удалить"
      color={t.danger}
      icon={Trash2}
      accessibilityLabel={`Удалить счёт ${account.name}`}
      onAction={onDelete}
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
          opacity: closed ? 0.45 : 1,
        }}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={[account.name, sub, mark, amount, closed ? "закрыт" : null]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint="Открывает правку счёта"
          // Свайпа для VoiceOver не существует — то же действие ротором.
          accessibilityActions={[
            closed ? { name: "reopen", label: "Открыть снова" } : { name: "hide", label: "Скрыть" },
            { name: "delete", label: "Удалить" },
          ]}
          onAccessibilityAction={(event) => {
            const name = event.nativeEvent.actionName;
            if (name === "hide") onHide();
            if (name === "reopen") closed?.onReopen();
            if (name === "delete") onDelete();
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
          <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 16, color: t.ink }}
            >
              {account.name}
            </Text>
            {sub ? (
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 13, color: t.sub }}
              >
                {sub}
              </Text>
            ) : null}
          </View>
          {mark ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              // Приглушается РАЗМЕРОМ (закон 2026-07-27), не серостью: 13pt
              // рядом с 16pt имени и 15pt суммой — справка, а не третий герой
              // строки.
              style={{ marginLeft: 8, fontSize: 13, color: t.sub }}
            >
              {mark}
            </Text>
          ) : null}
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
