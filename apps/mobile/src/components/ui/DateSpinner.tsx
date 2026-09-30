import { DateTimeInput } from "./DateTimeInput";

// БАРАБАН ДАТЫ — ОДНО ИМЯ НА ВСЕ ПЛАТФОРМЫ.
//
// На телефоне это системный спиннер: три барабана (число · месяц · год),
// которые человек уже знает по iOS. Рядом лежит `DateSpinner.web.tsx` — те же
// три барабана, собранные для браузера; Metro выбирает двойника сам.
//
// Отдельное имя нужно потому, что у `DateTimeInput` веб-двойник — поле
// браузера (`<input type="date">`), и это ПРАВИЛЬНО для строки настроек, где
// дата стоит справа как значение. Но в шторке выбора даты браузерное поле
// подменяло собой барабан: владелец 21.09 в дизайн-системе — «выбор дня
// рождения нужно сделать так, как у нас выбирается день, месяц и год, то есть
// тумблерами; это неправильно, как это сделано». Разошлись не платформы, а
// ДВА РАЗНЫХ МЕСТА: значение в строке и выбор в шторке. Поэтому у них теперь
// два имени, а не один компонент с флагом.

export interface DateSpinnerProps {
  value: Date;
  /** Раньше этой даты барабан не пускает. */
  minimumDate?: Date;
  /** Дальше этой даты барабан не пускает. */
  maximumDate?: Date;
  onChange: (next: Date) => void;
}

export function DateSpinner({ value, minimumDate, maximumDate, onChange }: DateSpinnerProps) {
  return (
    <DateTimeInput
      themeVariant="light"
      value={value}
      mode="date"
      display="spinner"
      locale="ru-RU"
      maximumDate={maximumDate}
      minimumDate={minimumDate}
      onChange={(_, next) => {
        if (next) onChange(next);
      }}
    />
  );
}
