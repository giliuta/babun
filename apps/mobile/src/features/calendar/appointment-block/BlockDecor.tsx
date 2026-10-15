import { Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { BLOCK_TEXT } from "@/components/ui/color-contrast";
import { BLOCK_GLASS } from "@/components/ui/RecordMark";

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

// БЛИК СВЕРХУ: три плёнки белого 7→5 % дают
// плавный объём без градиентной библиотеки (её нативный модуль
// потребовал бы пересборки клиента). Под текстом, касаний не
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
        right: 2,
        zIndex: 2,
        paddingHorizontal: 5,
        borderRadius: t.radius.card,
        backgroundColor: "rgba(11,18,32,0.78)",
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          color: BLOCK_TEXT,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "700",
          fontVariant: ["tabular-nums"],
        }}
      >
        {liveStart}
      </Text>
    </View>
  );
}

// «+N» СТОПКИ — справа вверху верхней карточки: под ней ещё записи
// на то же время; тап откроет их списком.
export function DeckBadge({
  deckMore,
  deckBadgeLow,
  color,
}: {
  deckMore: number;
  deckBadgeLow: boolean;
  color: string;
}) {
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
        minWidth: 18,
        height: 16,
        paddingHorizontal: 3,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.92)",
      }}
    >
      <Text
        maxFontSizeMultiplier={1.1}
        style={{
          fontSize: 11,
          lineHeight: 13,
          fontWeight: "800",
          color,
          fontVariant: ["tabular-nums"],
        }}
      >
        +{deckMore}
      </Text>
    </View>
  );
}

// УГЛОВОЙ ЗНАК ОДИН И ОДНОЗНАЧНЫЙ: белый круг с галкой — работа
// закрыта. Просрочка знака не носит: её сигнал — тёмный ободок
// блока, и два разных знака в углу на колонке недели, где глиф не
// рисуется, слились бы в два одинаковых кружка. Глиф рисуется только на широком
// блоке: SVG монтирует отдельное дерево на каждый знак, а неделя
// держит 21 колонку.
export function DoneMark({ markSize }: { markSize: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 2,
        right: 2,
        width: markSize,
        height: markSize,
        borderRadius: 999,
        // На плотной заливке зелёный круг тонул бы в зелёных записях;
        // белая плёнка с белой галкой читается на любом цвете.
        backgroundColor: "rgba(255,255,255,0.32)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {markSize >= 14 ? (
        <Check color={BLOCK_TEXT} size={10} strokeWidth={3.5} />
      ) : null}
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
