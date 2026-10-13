import { View } from "react-native";
import type { WorkBand } from "./types";
import { MinuteBand } from "./MinuteBand";

/** Column backdrop: label tint, off-hours wash, team breaks, the past. */
export function ColumnWashes({
  dateYmd,
  isToday,
  todayYmd,
  compact,
  tintColor,
  band,
  workStart,
  workEnd,
  winStartMin,
  winEndMin,
  offHoursFill,
  nowMin,
  nowMinutes,
}: {
  dateYmd: string;
  isToday: boolean;
  todayYmd?: string;
  compact: boolean;
  tintColor?: string | null;
  band: WorkBand | null;
  workStart: number;
  workEnd: number;
  winStartMin: number;
  winEndMin: number;
  offHoursFill: string;
  /** Minutes from the window start to now; null — not today / outside. */
  nowMin: number | null;
  nowMinutes?: number | null;
}) {
  return (
    <>
      {tintColor ? (
        // ~5% alpha of the label colour — reads as a hue, not a fill, so
        // gridlines / washes / blocks above keep their contrast.
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: `${tintColor}0d`,
          }}
        />
      ) : null}
      {/* off-hours wash: before work start / after work end */}
      {workStart > winStartMin ? (
        <MinuteBand
          fromMin={winStartMin}
          toMin={workStart}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={offHoursFill}
        />
      ) : null}
      {workEnd < winEndMin ? (
        <MinuteBand
          fromMin={workEnd}
          toMin={winEndMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={offHoursFill}
        />
      ) : null}

      {/* Перерывы команды (обед и т.п.) — тот же серый, что нерабочие часы:
          «сюда не записываем». Подпись только в широком дне. */}
      {band?.breaks?.map((b, i) =>
        b.endMin > winStartMin && b.startMin < winEndMin ? (
          <MinuteBand
            key={`break-${i}`}
            fromMin={Math.max(b.startMin, winStartMin)}
            toMin={Math.min(b.endMin, winEndMin)}
            winStartMin={winStartMin}
            winEndMin={winEndMin}
            color={offHoursFill}
            label={compact ? undefined : "Перерыв"}
          />
        ) : null,
      )}

      {nowMin != null ? (
        // Прошедшее время затемняется ОТЧЁТЛИВО (запрос владельца
        // 2026-07-16: «затемним участки, которые прошли») — 0.05 читается
        // сразу, но остаётся легче серых нерабочих часов (0.12).
        <MinuteBand
          fromMin={winStartMin}
          toMin={winStartMin + nowMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color="rgba(11,18,32,0.05)"
        />
      ) : null}
      {/* Прошедшие дни (неделя) — то же затемнение всей колонки: «что уже
          позади» видно при сканировании, тем же слоем, что «до сейчас».
          И сегодня после конца окна: в 19:59 колонка затемнена до низа, а
          в 20:30 была белой, как будущее (повторный аудит 03.10). */}
      {(todayYmd && dateYmd < todayYmd) ||
      (isToday && nowMinutes != null && nowMinutes > winEndMin) ? (
        <MinuteBand
          fromMin={winStartMin}
          toMin={winEndMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color="rgba(11,18,32,0.05)"
        />
      ) : null}
    </>
  );
}
