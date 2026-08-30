import { Pressable, Text, View } from "react-native";
import { WEEKDAY_LABELS } from "@babun/shared/local/services";
import { LabelTag } from "@/components/ui/LabelTag";
import { useThemeColors } from "@/theme/colors";

// ПРОЕКЦИЯ НЕДЕЛИ — колонка календаря, в которой вместо числа стоит день.
//
// Владелец 2026-08-30: «я хочу, чтоб это был один единый блок-бочонок… то же
// самое, как в календаре: идёт ряд дат, и ты просто выбираешь, только вместо
// чисел понедельник, вторник… не надо закрашивать весь бочонок голубым и
// потом внизу выписать „Лимассол"».
//
// БЫЛО ДВА РЯДА — плитка-переключатель и корешок метки под ней. Они говорили
// об одном и том же дне дважды и разными языками: сверху «выбрано» голубой
// заливкой, снизу «будет так» настоящим тегом. Теперь один элемент: НАЖИМАЕШЬ
// ДЕНЬ — В НЁМ ПОЯВЛЯЕТСЯ МЕТКА, ровно как она появится в календаре.
//
// ВЫБРАННОСТЬ НЕСЁТ САМА МЕТКА, А НЕ ЗАЛИВКА. Голубой бочонок был третьим
// способом сказать то, что уже сказано корешком, и вдобавок спорил с ним за
// цвет. В календаре день «с меткой» отличается от дня «без метки» именно
// наличием корешка — проекция обязана отличаться так же, иначе она не
// проекция.
//
// ПОЧЕМУ ЭТО НЕ ВРЁТ ПРО БЕССРОЧНОСТЬ. Неделя ТИПОВАЯ, без чисел: у неё нет
// ни первой даты, ни последней, и «докуда действует» она не обещает вовсе.
// Список «30 авг · 31 авг · 2 сен», стоявший здесь до этого, обещал ровно три
// дня — своим существованием, независимо от подписи.
//
// ЗЕРКАЛО, А НЕ ПОХОЖАЯ КАРТИНКА: корешок берётся из `LabelTag` — того самого
// примитива, которым метки нарисованы в шапке календаря и на карточке
// клиента. Своя вёрстка «в том же духе» разошлась бы с оригиналом на первой
// же его правке, и обещание «так и будет выглядеть» перестало бы выполняться.

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function WeekProjection({
  weekdays,
  color,
  name,
  ownName,
  takenBy,
  daysOff,
  onToggle,
  onBlocked,
}: {
  /** ISO-номера дней, выбранных для этой метки. */
  weekdays: number[];
  color: string;
  /** Имя метки КАК ЕГО ВИДНО СЕЙЧАС — им подписан корешок. Меняется на
   *  каждой букве: человек печатает и сразу видит метку в неделе. */
  name: string;
  /** Имя, ПОД КОТОРЫМ метка записана в справочнике; у новой — null.
   *
   *  ОТДЕЛЬНО ОТ `name` НАМЕРЕННО. Своей принадлежностью день опознаётся
   *  ТОЛЬКО по нему: сравнивай мы с живым полем, переименование прямо в форме
   *  делало бы метку чужой самой себе — её же дни становились бы «занятыми»,
   *  и сохранить правку было бы нельзя. */
  ownName: string | null;
  /** День недели → чужая метка, которая его держит. */
  takenBy: Map<number, { name: string; color: string | null }>;
  daysOff: Set<number>;
  onToggle: (day: number) => void;
  /** Тап по недоступному дню — экран объясняет причину словами. */
  onBlocked: (day: number, reason: "off" | { holder: string }) => void;
}) {
  const t = useThemeColors();
  const own = name.trim();
  const mineName = ownName ?? own;

  return (
    <View style={{ flexDirection: "row", gap: 5 }}>
      {ISO_DAYS.map((day) => {
        const off = daysOff.has(day);
        const holder = takenBy.get(day);
        const foreign = holder && holder.name !== mineName ? holder : null;
        const blocked = off || !!foreign;
        const mine = weekdays.includes(day) && !blocked;
        return (
          <Pressable
            key={day}
            onPress={() =>
              blocked
                ? onBlocked(day, off ? "off" : { holder: foreign?.name ?? "" })
                : onToggle(day)
            }
            accessibilityRole="button"
            accessibilityState={{ selected: mine, disabled: blocked }}
            accessibilityLabel={
              off
                ? `${WEEKDAY_LABELS[day]} — выходной`
                : foreign
                  ? `${WEEKDAY_LABELS[day]} — занят меткой ${foreign.name}`
                  : mine
                    ? `${WEEKDAY_LABELS[day]} — стоит метка ${own || "без имени"}`
                    : `${WEEKDAY_LABELS[day]} — без метки`
            }
            style={({ pressed }) => ({
              flex: 1,
              height: 56,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              backgroundColor: t.fill,
              // Занятый приглушён целиком — и день, и чужой корешок в нём:
              // это не «выключено», а «не твоё».
              opacity: blocked ? 0.5 : pressed ? 0.6 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: mine ? t.ink : t.faint,
              }}
            >
              {WEEKDAY_LABELS[day]}
            </Text>
            {/* Слот корешка ФИКСИРОВАННОЙ ВЫСОТЫ, как в шапке календаря:
                резервируется и пустым, иначе ряд прыгает по высоте на каждом
                тапе — прямо под пальцем. */}
            <View style={{ height: 15, justifyContent: "center" }}>
              {off ? (
                // Выходной занимает место метки первым — тем же красным и по
                // тому же правилу, что в шапке календаря: «работаем ли»
                // важнее, чем «где».
                <LabelTag color={t.danger} text="Вых" />
              ) : foreign ? (
                <LabelTag color={foreign.color ?? t.faint} text={foreign.name} />
              ) : mine ? (
                own ? (
                  <LabelTag color={color} text={own} />
                ) : (
                  // Имени ещё нет — но место уже занято. Пустой корешок
                  // честнее подставного слова: выдумывать метке имя,
                  // которого человек не вводил, нельзя.
                  <View
                    style={{
                      width: 22,
                      height: 13,
                      borderRadius: 4,
                      backgroundColor: `${color}29`,
                      borderWidth: 1,
                      borderColor: `${color}8c`,
                    }}
                  />
                )
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
