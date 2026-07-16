// Единая ячейка даты в шапке календаря (День «lg» + Неделя «sm») — одна
// модель состояний на все виды, чтобы дата читалась одинаково везде:
//
//   сегодня      — кобальтовая отметка (заливка/кольцо по варианту);
//   выбрана      — якорь календаря (в Неделе раньше был НЕВИДИМ вовсе);
//   прошедшая    — приглушена (день уже не планируют);
//   выходной     — красное число (Сб/Вс);
//   метка города — цвет метки: полоска/пилл/заливка по варианту; явная
//                  метка и унаследованный default_city рисуются одинаково
//                  (снятие через сентинел __NONE__ гасит обе).
//
// ВРЕМЕННЫЙ дев-переключатель вариантов: long-press по заголовку
// «Июль 2026» циклит 1→2→3 (персист в MMKV). После выбора владельцем
// оставить один вариант и удалить переключатель + лишние ветки.
import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { getStorage } from "@babun/shared/storage";
import { useThemeColors } from "@/theme/colors";

export type DateHeaderVariant = 1 | 2 | 3;

const VARIANT_KEY = "calendar.dateHeaderVariant";

export const VARIANT_TITLES: Record<DateHeaderVariant, string> = {
  1: "Пилюля",
  2: "Кольцо",
  3: "Цвет города",
};

export function useDateHeaderVariant(): {
  variant: DateHeaderVariant;
  cycle: () => DateHeaderVariant;
} {
  const [variant, setVariant] = useState<DateHeaderVariant>(() => {
    const v = getStorage().get<{ v?: number }>(VARIANT_KEY)?.v;
    return v === 2 || v === 3 ? v : 1;
  });
  // cycle возвращает НОВОЕ значение — вызывающему нужно имя для тоста.
  const cycle = useCallback((): DateHeaderVariant => {
    const cur = getStorage().get<{ v?: number }>(VARIANT_KEY)?.v;
    const safe: DateHeaderVariant = cur === 2 || cur === 3 ? cur : 1;
    const next = (safe === 3 ? 1 : safe + 1) as DateHeaderVariant;
    getStorage().set(VARIANT_KEY, { v: next });
    setVariant(next);
    return next;
  }, []);
  return { variant, cycle };
}

const WEEKDAYS_RU = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

export function DateCell({
  date,
  size,
  variant,
  isToday,
  isSelected = false,
  isPast = false,
  count = 0,
  label,
}: {
  date: Date;
  /** sm — ячейка недельной полосы; lg — шапка дневного вида. */
  size: "sm" | "lg";
  variant: DateHeaderVariant;
  isToday: boolean;
  /** Якорь календаря (в Дне не используется — там дата и есть якорь). */
  isSelected?: boolean;
  isPast?: boolean;
  count?: number;
  label?: { name: string; color: string } | null;
}) {
  const t = useThemeColors();
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const lg = size === "lg";
  const dow = WEEKDAYS_RU[(date.getDay() + 6) % 7];

  // Приоритет цвета числа: на заливке всегда onAccent; иначе выходной
  // красный; прошедшее — как ink, но контейнер приглушён opacity ниже.
  const numOn = (filled: boolean) =>
    filled ? t.onAccent : weekend ? t.danger : t.ink;
  const dowOn = (filled: boolean) =>
    filled ? t.onAccent : weekend ? t.danger : t.faint;

  // Бейдж-счётчик записей (только sm: в Дне под шапкой сама сетка).
  const countBadge =
    !lg && count > 0 ? (
      <Text
        className="tabular-nums"
        maxFontSizeMultiplier={1.2}
        style={{
          position: "absolute",
          top: 2,
          right: 3,
          fontSize: 10,
          fontWeight: "600",
          color: isToday || isSelected ? t.accent : t.faint,
        }}
      >
        {count}
      </Text>
    ) : null;

  // Имя метки: lg — полное (ширины хватает), sm — 3 буквы.
  const labelText = label ? (lg ? label.name : label.name.slice(0, 3)) : "";

  const dim = isPast && !isToday && !isSelected;

  let body: ReactNode;
  if (variant === 1) {
    // ── В1 «Пилюля»: выбранный день = кобальтовая вертикальная пилюля
    // (ДН+число вместе), сегодня = точка под числом. Метка — полоска
    // по нижней кромке (+ имя в lg).
    const filled = isSelected || (lg && isToday);
    body = (
      <>
        <View
          style={{
            alignItems: "center",
            borderRadius: 12,
            paddingHorizontal: lg ? 14 : 5,
            paddingVertical: 3,
            minWidth: lg ? 56 : 36,
            backgroundColor: filled ? t.accent : "transparent",
            opacity: dim ? 0.45 : 1,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: lg ? 11 : 10,
              fontWeight: "600",
              letterSpacing: 0.4,
              color: dowOn(filled),
              textTransform: "uppercase",
            }}
          >
            {dow}
          </Text>
          <Text
            className="tabular-nums"
            maxFontSizeMultiplier={1.2}
            style={{
              marginTop: 1,
              fontSize: lg ? 17 : 15,
              fontWeight: "700",
              color: filled ? t.onAccent : isToday ? t.accent : numOn(false),
            }}
          >
            {date.getDate()}
          </Text>
          {/* Сегодня без выбора — точка-«пульс» под числом. */}
          <View
            style={{
              marginTop: 1,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor:
                isToday && !filled ? t.accent : "transparent",
            }}
          />
        </View>
        {lg && label ? (
          <LabelPill color={label.color} text={labelText} />
        ) : null}
        {label ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 0,
              left: 6,
              right: 6,
              height: 3,
              borderTopLeftRadius: 3,
              borderTopRightRadius: 3,
              backgroundColor: label.color,
            }}
          />
        ) : null}
      </>
    );
  } else if (variant === 2) {
    // ── В2 «Кольцо»: сегодня = залитый круг (как сейчас), выбранный не
    // сегодня = кобальтовое кольцо. Метка — мини-пилл «точка + имя».
    body = (
      <>
        <View style={{ alignItems: "center", opacity: dim ? 0.45 : 1 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: lg ? 11 : 10,
              fontWeight: "600",
              letterSpacing: 0.4,
              color: dowOn(false),
              textTransform: "uppercase",
            }}
          >
            {dow}
          </Text>
          <View
            style={{
              marginTop: 2,
              height: 26,
              minWidth: 26,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 5,
              backgroundColor: isToday ? t.accent : "transparent",
              borderWidth: isSelected && !isToday ? 1.5 : 0,
              borderColor: t.accent,
            }}
          >
            <Text
              className="tabular-nums"
              maxFontSizeMultiplier={1.2}
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: numOn(isToday),
              }}
            >
              {date.getDate()}
            </Text>
          </View>
        </View>
        {label ? (
          <LabelPill
            color={label.color}
            text={labelText}
            dot={!lg}
            compact={!lg}
          />
        ) : null}
      </>
    );
  } else {
    // ── В3 «Цвет города»: ячейка целиком залита цветом метки (14%),
    // диспетчер видит маршрут недели одним взглядом. Число — как в В2.
    body = (
      <>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 2,
            bottom: 2,
            left: 2,
            right: 2,
            borderRadius: 10,
            backgroundColor: label ? `${label.color}24` : "transparent",
          }}
        />
        <View style={{ alignItems: "center", opacity: dim ? 0.45 : 1 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: lg ? 11 : 10,
              fontWeight: "600",
              letterSpacing: 0.4,
              color: dowOn(false),
              textTransform: "uppercase",
            }}
          >
            {dow}
          </Text>
          <View
            style={{
              marginTop: 2,
              height: 26,
              minWidth: 26,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 5,
              backgroundColor: isToday ? t.accent : "transparent",
              borderWidth: isSelected && !isToday ? 1.5 : 0,
              borderColor: t.accent,
            }}
          >
            <Text
              className="tabular-nums"
              maxFontSizeMultiplier={1.2}
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: numOn(isToday),
              }}
            >
              {date.getDate()}
            </Text>
          </View>
          {label ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={{
                marginTop: 1,
                fontSize: lg ? 11 : 9,
                fontWeight: "700",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: label.color,
              }}
            >
              {labelText}
            </Text>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 2,
        paddingBottom: 4,
      }}
    >
      {body}
      {countBadge}
    </View>
  );
}

// Пилл метки: в lg — полное имя на тонированной подложке; в sm (В2) —
// компакт «цветная точка + 3 буквы».
function LabelPill({
  color,
  text,
  dot = false,
  compact = false,
}: {
  color: string;
  text: string;
  dot?: boolean;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        marginTop: 3,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        paddingHorizontal: compact ? 5 : 8,
        paddingVertical: 2,
        backgroundColor: `${color}1f`,
      }}
    >
      {dot ? (
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 2.5,
            marginRight: 3,
            backgroundColor: color,
          }}
        />
      ) : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: compact ? 9 : 10,
          fontWeight: "700",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
