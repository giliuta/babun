import { Text, View } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import type { ViewStyle } from "react-native";
import type { BlockMoney } from "@/features/calendar/block-status";
import { useThemeColors } from "@/theme/colors";
import { BLOCK_TEXT } from "@/components/ui/color-contrast";
import { BLOCK_GLASS } from "@/components/ui/RecordMark";
import { liveTimeLines } from "./live-time-lines";

/** Блик — общий со знаком записи в настройках (`BLOCK_GLASS`). */
const GLASS = BLOCK_GLASS;

// РУЧКА РАСТЯЖКИ — видно, что нижний край тянется. Сам край ловит
// общий жест карточки (`edgeMode`), ручка касаний не принимает.
export function ResizeHandles({ cardH }: { cardH: number }) {
  return (
    <>
      {(cardH >= 40 ? (["top", "bottom"] as const) : (["bottom"] as const)).map(
        (edge) => (
          <View
            key={edge}
            pointerEvents="none"
            style={{
              position: "absolute",
              [edge]: 3,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 22,
                height: 4,
                borderRadius: 999,
                backgroundColor: "rgba(255,255,255,0.9)",
              }}
            />
          </View>
        ),
      )}
    </>
  );
}

// БЛИК СВЕРХУ: плёнки белого дают плавный объём без градиентной
// библиотеки (её нативный модуль потребовал бы пересборки клиента). Лежит
// НАД текстом и тающим хвостом: текст белый, и белая плёнка его не меняет,
// а хвост в цвет блока иначе лёг бы тёмной полосой поверх блика. Касаний не
// принимает; у отменённой блика нет.
export function BlockGlass() {
  return (
    <>
      {GLASS.map(([h, a]) => (
        <View
          key={h}
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: h,
            backgroundColor: `rgba(255,255,255,${a})`,
          }}
        />
      ))}
    </>
  );
}

// НОВОЕ ВРЕМЯ — ПРЯМО НА КАРТОЧКЕ, пока она под пальцем: рельс
// слева далеко от пальца, а магнит щёлкает по получасам.
export function LiveTimeBadge({ liveStart }: { liveStart: string }) {
  const t = useThemeColors();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 2,
        left: 2,
        right: 2,
        zIndex: 2,
        alignItems: "flex-end",
      }}
    >
      <View
        style={{
          maxWidth: "100%",
          paddingHorizontal: 4,
          borderRadius: t.radius.card,
          backgroundColor: "rgba(11,18,32,0.78)",
        }}
      >
        {liveTimeLines(liveStart).map((line) => (
          <Text
            key={line}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={1.2}
            style={{
              color: BLOCK_TEXT,
              fontSize: 13,
              lineHeight: 17,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

// «+N» СТОПКИ — справа вверху верхней карточки: под ней ещё записи
// на то же время; тап откроет их списком.
// НАКЛАДКА — КРАСНЫМ. Две рабочие записи на одно время — то, что
// диспетчер обязан увидеть сразу: белое «+1» читалось как «тут ещё что-то»,
// а не «здесь две бригады в одно время».
// Заливка значка накладки — красный «опасности» продукта, токеном `danger`:
// свой #D92D20 был вторым красным рядом с `danger` (пачка 5, Д14).

export function DeckBadge({
  deckMore,
  deckBadgeLow,
  color,
  clash = false,
}: {
  deckMore: number;
  deckBadgeLow: boolean;
  color: string;
  clash?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        // Высокая карточка — «+N» в нижнем углу, имя не трогает;
        // низкая — в верхнем, а имя уступает ему место.
        ...(deckBadgeLow ? { bottom: 4 } : { top: 2 }),
        right: 2,
        zIndex: 3,
        minWidth: clash ? 22 : 18,
        height: 16,
        paddingHorizontal: 3,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: clash ? t.danger : "rgba(255,255,255,0.92)",
        borderWidth: clash ? 1 : 0,
        borderColor: "#FFFFFF",
      }}
    >
      <Text
        maxFontSizeMultiplier={1.1}
        style={{
          fontSize: 11,
          lineHeight: 13,
          fontWeight: "800",
          color: clash ? "#FFFFFF" : color,
          fontVariant: ["tabular-nums"],
        }}
      >
        +{deckMore}
      </Text>
    </View>
  );
}

// ЧУЖАЯ МЕТКА — точка в нижнем углу: сам блок залит цветом записи.
// Точка несёт цвет метки как есть, а белое кольцо отделяет её от
// чужой заливки при любом сочетании.
export function OffLabelDot({ color }: { color: string }) {
  return (
    <View
      style={{
        position: "absolute",
        bottom: 2,
        right: 2,
        width: 9,
        height: 9,
        borderRadius: 999,
        // Точка лежит на плотном чужом цвете: белое кольцо отделяет
        // её от заливки, и цвет метки виден как есть.
        backgroundColor: color,
        borderWidth: 1.5,
        borderColor: BLOCK_TEXT,
      }}
    />
  );
}

/** Тающий хвост: ширина и ступени плотности плёнки (слева направо). */
const FADE_W = 14;
const FADE_STEPS = [0.15, 0.35, 0.55, 0.75, 0.92];

// ТАЮЩИЙ ХВОСТ — плёнка в цвет заливки у правого края строки, ступенями от
// прозрачной к плотной: не влезающие имя, время или услуга растворяются, а
// не рубятся по букве. Ступени, а не градиент: градиентный модуль нативный, а
// блок обновляется по воздуху. Отклик под пальцем — тот же `fillStyle`, что у
// карточки.
export function FadeTail({
  rows,
  top,
  lineH,
  inset,
  fillStyle,
}: {
  rows: number[];
  /** Верх первой строки внутри карточки. */
  top: number;
  lineH: number;
  /** Правый паддинг карточки — плёнка закрывает и его. */
  inset: number;
  fillStyle: AnimatedStyle<ViewStyle>;
}) {
  return (
    <>
      {rows.map((row) => (
        <View
          key={row}
          pointerEvents="none"
          style={{
            position: "absolute",
            top: top + row * lineH,
            height: lineH,
            right: 0,
            width: FADE_W + inset,
            flexDirection: "row",
          }}
        >
          {FADE_STEPS.map((a) => (
            <Animated.View key={a} style={[{ flex: 1, opacity: a }, fillStyle]} />
          ))}
          <Animated.View style={[{ width: inset }, fillStyle]} />
        </View>
      ))}
    </>
  );
}

/** Значки оплаты словами — для VoiceOver: значок без подписи немой. */
export function moneyWords(money: BlockMoney): string {
  if (!money || money.state === "unpaid") return "";
  if (money.state === "partial") return ", оплачена частично";
  if (money.method === "cash") return ", оплачена наличными";
  if (money.method === "card") return ", оплачена картой";
  if (money.method === "transfer") return ", оплачена переводом";
  return ", оплачена";
}
