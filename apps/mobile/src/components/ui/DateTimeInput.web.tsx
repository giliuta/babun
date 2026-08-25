// Веб-двойник DateTimeInput. Контракт пропов повторяет нативный пикер
// (value/mode/minuteInterval/minimumDate/maximumDate/onChange), поэтому места
// вызова переписываются заменой имени компонента, без правки пропов.
// Нативная косметика (display/locale/themeVariant) принимается и не читается —
// в браузере вид выбора задаёт сам браузер.
//
// Барабан (TimeWheel) сюда не годится: дат он не умеет вовсе, а его инерция
// держится на onMomentumScrollEnd/snapToInterval, которые react-native-web
// эмулирует по-своему. `<input type="date">` и `<input type="time">` дают
// системный выбор, который человек в браузере уже знает.

type ChangeEvent = {
  type: "set";
  nativeEvent: { timestamp: number; utcOffset: number };
};

export interface DateTimeInputProps {
  value: Date;
  /** ТОЛЬКО «date» и «time» — ровно то, что двойник умеет нарисовать.
   *
   *  Нативный пакет знает ещё «datetime» и «countdown», и раньше они стояли
   *  и здесь — но разметка ниже смотрит только на `time`, то есть «datetime»
   *  молча превращался в голую дату, а «countdown» — тем более. Подпись
   *  обещала больше, чем реализация даёт: в браузере человек потерял бы
   *  время, не увидев на это ни ошибки, ни предупреждения.
   *
   *  Убрано, а не реализовано, потому что продукт этих режимов не просит:
   *  дату и время он спрашивает ДВУМЯ строками (см. AppointmentSheet и
   *  RescheduleSheet — `mode="date"` рядом с `mode="time"`), а обратный
   *  отсчёт не спрашивает нигде. Заводить `<input type="datetime-local">`
   *  ради ноля мест вызова значит завести непроверяемую ветку. Понадобится —
   *  вернём вместе с местом, где это видно человеку; сторож в
   *  lib/web-parity-contract.test.ts следит, чтобы союз и разметка не
   *  разъезжались. */
  mode?: "date" | "time";
  /** Шаг минут: 5 → step="300" у `<input type="time">`. */
  minuteInterval?: number;
  minimumDate?: Date;
  maximumDate?: Date;
  onChange?: (event: ChangeEvent, date?: Date) => void;
  /** Подпись для скринридера — у пикера времени в строке её несёт сам ряд
   *  («Начало перерыва»), а не видимый текст. На вебе это aria-label. */
  accessibilityLabel?: string;
  /** Выключенный ввод (нативный проп `disabled`) — на вебе тот же атрибут. */
  disabled?: boolean;
  /** Android-косметика: 24-часовой формат. В браузере формат `<input
   *  type="time">` выбирает локаль системы, поменять его нечем — принимаем,
   *  чтобы места вызова не расходились, и не читаем. */
  is24Hour?: boolean;
  /** Стиль места вызова. Пропускаем ТОЛЬКО простой объект: RN-стиль бывает
   *  массивом или числом-идентификатором, а DOM ждёт словарь. Ключи вида
   *  `paddingHorizontal` браузер молча игнорирует — это не ошибка, просто
   *  нативная косметика мимо. */
  style?: unknown;
  /** Нативная косметика — принимаем, чтобы не трогать места вызова. */
  display?: string;
  locale?: string;
  themeVariant?: string;
  accentColor?: string;
  textColor?: string;
  testID?: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Локальные ЧЧ:ММ и ГГГГ-ММ-ДД: `<input>` работает в часовом поясе
 *  пользователя, а toISOString() увёл бы дату на день назад. */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function DateTimeInput({
  value,
  mode = "date",
  minuteInterval,
  minimumDate,
  maximumDate,
  onChange,
  accessibilityLabel,
  disabled,
  style,
  testID,
}: DateTimeInputProps) {
  const time = mode === "time";
  const extraStyle =
    style && typeof style === "object" && !Array.isArray(style)
      ? (style as Record<string, unknown>)
      : null;

  const emit = (next: Date) => {
    if (Number.isNaN(next.getTime())) return;
    onChange?.(
      {
        type: "set",
        nativeEvent: {
          timestamp: next.getTime(),
          utcOffset: -next.getTimezoneOffset(),
        },
      },
      next,
    );
  };

  return (
    <input
      data-testid={testID}
      aria-label={accessibilityLabel}
      disabled={disabled}
      type={time ? "time" : "date"}
      // Стартовое значение всегда живое: без него в браузере остаётся
      // пустое поле, а «Применить» проставляет то, чем инициализирован
      // черновик, а не то, что выбрал человек.
      value={time ? hm(value) : ymd(value)}
      step={time && minuteInterval ? minuteInterval * 60 : undefined}
      min={!time && minimumDate ? ymd(minimumDate) : undefined}
      max={!time && maximumDate ? ymd(maximumDate) : undefined}
      onChange={(e) => {
        const raw = e.target.value;
        if (!raw) return;
        const next = new Date(value.getTime());
        if (time) {
          const [h, m] = raw.split(":").map(Number);
          next.setHours(h, m, 0, 0);
        } else {
          const [y, mo, d] = raw.split("-").map(Number);
          next.setFullYear(y, mo - 1, d);
        }
        emit(next);
      }}
      style={{
        appearance: "none",
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 17,
        fontFamily: "inherit",
        color: "inherit",
        background: "transparent",
        minHeight: 44,
        ...extraStyle,
      }}
    />
  );
}
