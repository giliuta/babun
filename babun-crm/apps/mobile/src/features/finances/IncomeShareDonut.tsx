// «Доли» — donut over the income breakdown. Port of the web
// FinancePieChart (apps/web/src/components/finance/FinancePieChart.tsx),
// which was the last finance surface with no mobile equivalent —
// ProfitBreakdown.tsx even names it: «The web "Доли %" donut toggle is
// deferred». This closes that.
//
// TWO DELIBERATE DEVIATIONS FROM THE WEB CHART:
//
//   1. Palette. The web pie paints wedges green/blue/orange/purple/sky/
//      yellow. Halo Cobalt principle #1 is «color = meaning; never
//      decorate with semantic color» — green means money-in and red
//      money-out app-wide, so a green wedge next to an orange one would
//      claim a meaning these slices don't have (they are ALL income).
//      Instead the wedges are one cobalt ramp: the same accent composited
//      over the card at descending alpha via tintOver(). Slices stay
//      distinguishable by luminance, and the section keeps reading as
//      «this is all income».
//   2. Donut, not pie. A ring leaves the middle free for the total, so
//      the chart answers «сколько всего» and «из чего» at once instead
//      of needing a separate hero.
//
// Math mirrors the web component: negatives clamped to 0, sorted desc,
// everything past topN collapsed into one «Прочее» wedge so a long tail
// doesn't shatter the ring into invisible slivers.

import { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { tintOver } from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";
import type { BreakdownRow } from "./breakdown";

/** Ramp alphas, strongest first. Six steps then «Прочее» grey — matches
 *  the web chart's 6-colour palette + REST_COLOR. */
const RAMP_ALPHA = [1, 0.78, 0.6, 0.44, 0.3, 0.19] as const;

const SIZE = 132;
const STROKE = 26;

interface Slice {
  id: string;
  name: string;
  value: number;
  color: string;
}

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** Annulus wedge path: outer arc clockwise, inner arc back. */
function wedgePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, start);
  const o2 = polar(cx, cy, rOuter, end);
  const i2 = polar(cx, cy, rInner, end);
  const i1 = polar(cx, cy, rInner, start);
  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function IncomeShareDonut({
  rows,
  topN = 5,
}: {
  rows: BreakdownRow[];
  topN?: number;
}) {
  const th = useThemeColors();

  const slices = useMemo<Slice[]>(() => {
    // Refund buckets can net negative; a negative share is meaningless in
    // a part-of-whole chart, so clamp them out exactly like the web does.
    const cleaned = rows
      .map((r) => ({ id: r.id, name: r.name, value: Math.max(0, r.amount) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);

    const paint = (i: number): string =>
      tintOver(th.accent, th.surface, RAMP_ALPHA[i] ?? RAMP_ALPHA[RAMP_ALPHA.length - 1]);

    if (cleaned.length <= topN) {
      return cleaned.map((r, i) => ({ ...r, color: paint(i) }));
    }
    const head = cleaned.slice(0, topN);
    const tail = cleaned.slice(topN);
    const tailTotal = tail.reduce((s, r) => s + r.value, 0);
    const out: Slice[] = head.map((r, i) => ({ ...r, color: paint(i) }));
    if (tailTotal > 0) {
      out.push({
        id: "__rest__",
        name: `Прочее (${tail.length})`,
        value: tailTotal,
        // Grey, not a ramp step: «Прочее» is a leftover, not a rank.
        color: tintOver(th.sub, th.surface, 0.34),
      });
    }
    return out;
  }, [rows, topN, th.accent, th.surface, th.sub]);

  const total = slices.reduce((s, r) => s + r.value, 0);
  if (slices.length === 0 || total === 0) return null;

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rOuter = SIZE / 2;
  const rInner = rOuter - STROKE;

  // A lone slice is a full turn — an arc with equal start/end paints
  // nothing, so draw the ring as a stroked circle instead.
  const single = slices.length === 1;
  let cursor = 0;
  const wedges = single
    ? []
    : slices.map((s) => {
        const start = (cursor / total) * Math.PI * 2 - Math.PI / 2;
        cursor += s.value;
        const end = (cursor / total) * Math.PI * 2 - Math.PI / 2;
        return { id: s.id, color: s.color, d: wedgePath(cx, cy, rOuter, rInner, start, end) };
      });

  return (
    <View className="flex-row items-center px-4 pb-1 pt-2">
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {single ? (
            <Circle
              cx={cx}
              cy={cy}
              r={rOuter - STROKE / 2}
              stroke={slices[0].color}
              strokeWidth={STROKE}
              fill="none"
            />
          ) : (
            wedges.map((w) => <Path key={w.id} d={w.d} fill={w.color} />)
          )}
        </Svg>
        {/* Total in the hole — tabular so it doesn't jitter between periods. */}
        <View className="absolute inset-0 items-center justify-center">
          <Text
            className="text-[15px] font-semibold tabular-nums"
            style={{ color: th.ink }}
            numberOfLines={1}
          >
            {formatEUR(total)}
          </Text>
        </View>
      </View>

      <View className="ml-3 flex-1">
        {slices.map((s) => (
          <View key={s.id} className="flex-row items-center py-[3px]">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <Text
              className="ml-2 shrink text-[13px]"
              style={{ color: th.ink }}
              numberOfLines={1}
            >
              {s.name}
            </Text>
            <Text
              className="ml-auto pl-2 text-[13px] tabular-nums"
              style={{ color: th.sub }}
            >
              {Math.round((s.value / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
