import type { WorkBand } from "./types";
import { MinuteBand } from "./MinuteBand";

// ПЕРЕПАДЫ ЧИТАЮТСЯ СРАЗУ: будущее — чистый белый, прошедшее — заметно
// серое (8%), нерабочее — один тёмный слой; сплошная серость давит на глаза.
const PAST_FILL = "rgba(11,18,32,0.08)";

/** Column backdrop: off-hours wash, team breaks, the past, label tint. */
export function ColumnWashes({
  dateYmd,
  isToday,
  todayYmd,
  compact,
  tintColor,
  band,
  workStart,
  workEnd,
  workSegs,
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
  workSegs: { from: number; to: number }[];
  winStartMin: number;
  winEndMin: number;
  offHoursFill: string;
  /** Minutes from the window start to now; null — not today / outside. */
  nowMin: number | null;
  nowMinutes?: number | null;
}) {
  // До какой минуты окна время уже прошло (null — ничего не прошло).
  const pastEnd =
    (todayYmd && dateYmd < todayYmd) ||
    (isToday && nowMinutes != null && nowMinutes > winEndMin)
      ? winEndMin
      : nowMin != null
        ? winStartMin + nowMin
        : null;
  return (
    <>
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

      {/* ПРОШЕДШЕЕ И МЕТКА — ТОЛЬКО НА РАБОЧИХ ЧАСАХ: нерабочее время и
          выходной одного цвета, прошло оно или нет. «Прошло» — до сейчас у
          сегодня, весь день у прошедших дней и у сегодня после конца окна
          (иначе в 20:30 колонка белела бы, как будущее). */}
      {pastEnd != null
        ? workSegs.map((seg) =>
            seg.from < pastEnd ? (
              <MinuteBand
                key={`past-${seg.from}`}
                fromMin={seg.from}
                toMin={Math.min(seg.to, pastEnd)}
                winStartMin={winStartMin}
                winEndMin={winEndMin}
                color={PAST_FILL}
              />
            ) : null,
          )
        : null}
      {/* Метка дня — ~5% её цвета поверх серого «прошло»: прошедший день
          метку не гасит. */}
      {tintColor
        ? workSegs.map((seg) => (
            <MinuteBand
              key={`tint-${seg.from}`}
              fromMin={seg.from}
              toMin={seg.to}
              winStartMin={winStartMin}
              winEndMin={winEndMin}
              color={`${tintColor}0d`}
            />
          ))
        : null}
    </>
  );
}
