// Единая ячейка даты в шапке календаря (День «lg» + Неделя «sm») — дизайн
// «Маршрут» v4: анатомия недельной шапки веб-версии (одобрена владельцем),
// чистая типографика без фигур и выделений.
//
//   анатомия     — ДН сверху, крупное чёрное число, под ним имя метки
//                  цветом + цветная полоса по нижней кромке (web parity);
//   сегодня      — кобальтовое число (только цвет, никаких подчёркиваний);
//   выходной     — красные и ДН, и число (web);
//   прошедшая    — приглушена (день уже не планируют);
//   метка (lg)   — пилл «точка + полное имя города».
//
// «Выбранного дня» в Неделе нет: тап по дате открывает попап метки,
// долгий тап проваливается в День (см. WeekHeaderRow).
import { Text, View } from "react-native";
import { LabelTag } from "@/components/ui/LabelTag";
import { useThemeColors } from "@/theme/colors";

const WEEKDAYS_RU = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

export function DateCell({
  date,
  size,
  isToday,
  isPast = false,
  count = 0,
  label,
}: {
  date: Date;
  /** sm — ячейка недельной полосы; lg — шапка дневного вида. */
  size: "sm" | "lg";
  isToday: boolean;
  isPast?: boolean;
  count?: number;
  label?: { name: string; color: string } | null;
}) {
  const t = useThemeColors();
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const dow = WEEKDAYS_RU[(date.getDay() + 6) % 7];
  const dim = isPast && !isToday;

  // ДВА РАЗНЫХ СИГНАЛА, И ОНИ НЕ СПОРЯТ (владелец 2026-08-07):
  //   • ШАПКА красит субботу и воскресенье красным — это государственные
  //     выходные, общий ориентир, он не зависит от бригады;
  //   • ВЫХОДНОЙ БРИГАДЫ живёт в самой колонке: график задан выходным —
  //     колонка не подсвечена и кубиков в ней нет.
  // Поэтому «работаем по субботам» читается как красная шапка над обычной
  // рабочей колонкой, а выходной понедельник — как чёрная шапка над пустой.
  const numColor = isToday ? t.accent : weekend ? t.danger : t.ink;
  const dowColor = isToday ? t.accent : weekend ? t.danger : t.faint;

  if (size === "lg") {
    // Шапка Дня — та же колонка, что в Неделе, только крупнее: ДН над
    // числом, внизу корешок метки с ПОЛНЫМ именем. Ряды фиксированные —
    // число не двигается при появлении/смене метки.
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 3,
          opacity: dim ? 0.4 : 1,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            height: 14,
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: dowColor,
          }}
        >
          {dow}
        </Text>
        <Text
          className="tabular-nums"
          maxFontSizeMultiplier={1.2}
          style={{
            height: 28,
            fontSize: 24,
            lineHeight: 28,
            fontWeight: "700",
            color: numColor,
          }}
        >
          {date.getDate()}
        </Text>
        <View style={{ height: 16, justifyContent: "center" }}>
          {label ? <LabelTag color={label.color} text={label.name} lg /> : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 3,
        paddingBottom: 3,
      }}
    >
      {/* Ряды фиксированной высоты: число у ВСЕХ ячеек на одной строке —
          слот метки резервируется и пустым, ничего не прыгает. */}
      <View style={{ alignItems: "center", opacity: dim ? 0.4 : 1 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            height: 13,
            fontSize: 10,
            fontWeight: "600",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: dowColor,
          }}
        >
          {dow}
        </Text>
        <Text
          className="tabular-nums"
          maxFontSizeMultiplier={1.2}
          style={{
            height: 27,
            fontSize: 22,
            lineHeight: 27,
            fontWeight: "700",
            color: numColor,
          }}
        >
          {date.getDate()}
        </Text>
        {/* Корешок метки — фиксированный слот: число не двигается при
            появлении/смене метки, меняется только он. */}
        <View style={{ height: 15, justifyContent: "center" }}>
          {label ? (
            <LabelTag color={label.color} text={label.name.slice(0, 4)} />
          ) : null}
        </View>
      </View>
      {count > 0 ? (
        <Text
          className="tabular-nums"
          maxFontSizeMultiplier={1.2}
          style={{
            position: "absolute",
            top: 2,
            right: 4,
            fontSize: 10,
            fontWeight: "600",
            color: isToday ? t.accent : t.faint,
          }}
        >
          {count}
        </Text>
      ) : null}
    </View>
  );
}

// Корешок метки города — вынесен в DS (@/components/ui/LabelTag): тот же
// компонент рисует метку на карточке клиента. Правки вида — только там.
