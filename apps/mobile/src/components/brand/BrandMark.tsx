import { useId } from "react";
import { Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

// Знак Babun — голова бабуина анфас, «широкая морда» (выбор владельца
// 2026-10-03): сплошная кобальтовая грива, светлая маска лица, плитка
// «Рассвет». Сетка 200×200, симметрия по x=100. Мастера —
// assets/brand/mark.svg и assets/brand/tile.svg; история выбора и правила —
// docs/BRAND.md.

export const MANE_PATH =
  "M 100 16 C 130 16 152 30 160 50 C 170 54 178 58 184 64 C 178 70 172 74 168 78 " +
  "C 178 84 186 90 192 98 C 184 104 178 108 172 110 C 180 118 184 126 186 134 " +
  "C 178 136 170 138 164 138 C 166 146 166 154 164 162 C 156 160 150 158 146 156 " +
  "C 138 172 122 186 100 190 C 78 186 62 172 54 156 C 50 158 44 160 36 162 " +
  "C 34 154 34 146 36 138 C 30 138 22 136 14 134 C 16 126 20 118 28 110 " +
  "C 22 108 16 104 8 98 C 14 90 22 84 32 78 C 28 74 22 70 16 64 " +
  "C 22 58 30 54 40 50 C 48 30 70 16 100 16 Z";

export const FACE_PATH =
  "M 100 52 C 116 46 138 46 148 54 C 154 60 152 74 144 82 C 138 88 134 92 133 100 " +
  "L 132 146 C 132 158 126 166 114 166 L 86 166 C 74 166 68 158 68 146 L 67 100 " +
  "C 66 92 62 88 56 82 C 48 74 46 60 52 54 C 62 46 84 46 100 52 Z";

const EYE_RIGHT = "M 107 64 L 127 64 C 127 71 122 75 117 75 C 112 75 107 71 107 64 Z";
const EYE_LEFT = "M 93 64 L 73 64 C 73 71 78 75 83 75 C 88 75 93 71 93 64 Z";
const FOLDS = ["M 114 92 L 117 138", "M 86 92 L 83 138", "M 100 96 L 100 132"];
// Nostrils are tilted ellipses drawn as arcs: a rotated <Ellipse> turns
// around the canvas origin on web, so the tilt lives in the path itself.
const NOSTRIL_LEFT =
  "M 82.72 151.68 A 6.5 4.2 -15 1 0 95.28 148.32 A 6.5 4.2 -15 1 0 82.72 151.68 Z";
const NOSTRIL_RIGHT =
  "M 104.72 148.32 A 6.5 4.2 15 1 0 117.28 151.68 A 6.5 4.2 15 1 0 104.72 148.32 Z";

const MANE_FROM = "#2f6fd6";
const MANE_TO = "#1f4fcc";
const FACE = "#eef3fe";
const FOLD = "#c3d3f6";
const INK = "#0b1220";
const DAWN = [
  { offset: "0", color: "#fdeee2" },
  { offset: "0.5", color: "#f1f0f7" },
  { offset: "1", color: "#cfdcf8" },
] as const;

function Head({ maneId }: { maneId: string }) {
  return (
    <>
      <Path d={MANE_PATH} fill={`url(#${maneId})`} />
      <Path d={FACE_PATH} fill={FACE} />
      <Path d={EYE_RIGHT} fill={INK} />
      <Path d={EYE_LEFT} fill={INK} />
      <Circle cx={120.5} cy={68} r={1.8} fill="#fff" />
      <Circle cx={86.5} cy={68} r={1.8} fill="#fff" />
      {FOLDS.map((d) => (
        <Path key={d} d={d} stroke={FOLD} strokeWidth={3} strokeLinecap="round" />
      ))}
      <Path d={NOSTRIL_LEFT} fill={INK} />
      <Path d={NOSTRIL_RIGHT} fill={INK} />
    </>
  );
}

export type BrandMarkVariant =
  /** голова на прозрачном — рядом со словом, в документах */
  | "flat"
  /** плитка «Рассвет» с головой — как иконка приложения */
  | "tile";

export function BrandMark({
  size = 64,
  variant = "flat",
  shadow,
}: {
  size?: number;
  variant?: BrandMarkVariant;
  /** boxShadow плитки — бренд-тень темы, только для "tile" */
  shadow?: string;
}) {
  const tile = variant === "tile";
  // Gradient ids are document-global on web: with a fixed id the login
  // screen kept mounted under «Создать аккаунт» owns the gradient, and
  // url(#…) into a display:none subtree paints nothing.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maneId = `babunMane${uid}`;
  const dawnId = `babunDawn${uid}`;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Babun"
      style={
        tile
          ? { width: size, height: size, borderRadius: size * 0.28, overflow: "hidden", boxShadow: shadow }
          : { width: size, height: size }
      }
    >
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <LinearGradient id={maneId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={MANE_FROM} />
            <Stop offset="1" stopColor={MANE_TO} />
          </LinearGradient>
          <LinearGradient id={dawnId} x1="0" y1="0" x2="0.5" y2="1">
            {DAWN.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>
        {tile ? (
          <>
            <Rect width={200} height={200} fill={`url(#${dawnId})`} />
            <G transform="translate(20 24) scale(0.8)">
              <Head maneId={maneId} />
            </G>
          </>
        ) : (
          <Head maneId={maneId} />
        )}
      </Svg>
    </View>
  );
}

// Знак со словом в строку — шапка страниц, которые открывают без входа
// («Оплата прошла», приглашение): человек видит, чьё это окно.
export function BrandLockup({ size = 36 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: size * 0.28 }}>
      <BrandMark size={size} variant="tile" />
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: size * 0.62, fontWeight: "800", letterSpacing: -0.4, color: INK }}
      >
        Babun
      </Text>
    </View>
  );
}
