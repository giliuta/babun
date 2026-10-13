import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { FieldLabel } from "@/components/ui/Field";
import { GUTTER } from "@/components/ui/tokens";
import { durationLabel } from "@/features/services/format";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { useThemeColors } from "@/theme/colors";
import type { ServiceSheetState } from "./use-service-sheet";

// ПЕРЕРЫВ ПОСЛЕ УСЛУГИ. Не часть работы, а то, что идёт ПОСЛЕ неё:
// дорога до следующего объекта, уборка, мойка инструмента. В сетку
// он встаёт вместе с записью, поэтому следующая работа не садится
// вплотную — а раньше садилась, и день оказывался плотнее, чем он
// есть на самом деле.
//
// Пресеты, а не поле ввода: перерыв — это «пятнадцать минут» или
// «полчаса», а не 17. Клавиатура ради двух цифр здесь лишняя.
// «Нет» снимает параметр целиком — то же, что крестик.
export function ServiceBufferBlock({ sheet }: { sheet: ServiceSheetState }) {
  const t = useThemeColors();
  const { hasBufferAfter, setHasBufferAfter, bufferAfter, setBufferAfter, bufferAfterMin } = sheet;
  return hasBufferAfter ? (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 18 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <FieldLabel
          text={`Перерыв после услуги · ${durationLabel(bufferAfterMin)}`}
        />
        <Pressable
          onPress={() => {
            setHasBufferAfter(false);
            setBufferAfter("0");
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Убрать перерыв после услуги"
          style={({ pressed }) => ({
            paddingBottom: 6,
            opacity: pressed ? 0.4 : 1,
          })}
        >
          <X color={t.faint} size={16} strokeWidth={2} />
        </Pressable>
      </View>
      {/* ВРЕМЯ ВЫБИРАЕТСЯ БАРАБАНОМ. ВСЕГДА. Первый заход поставил здесь
          пресеты 10/15/20/30/45/60 — и это было нарушением архитектуры
          продукта, а не находкой: время в Babun выбирают барабаном везде,
          от часов календаря до длительности услуги строкой выше. Владелец
          2026-08-29: «у нас же выбор времени всегда заложен барабанами,
          на хуя тут 10, 15, 20». Пресеты вдобавок ВРАЛИ: перерыв в 25
          минут ими не выставить вовсе. */}
      <View style={{ alignItems: "center" }}>
        <TimeWheelPair
          hour={Math.floor(bufferAfterMin / 60)}
          minute={bufferAfterMin % 60}
          // Половины коммитятся ПОРОЗНЬ и каждая считает от предыдущего
          // состояния: колонка знает соседнее значение только по пропу, и
          // два коммита в одном батче унесли бы устаревшую половину.
          onChangeHour={(next) =>
            setBufferAfter(String(next * 60 + (bufferAfterMin % 60)))
          }
          onChangeMinute={(next) =>
            setBufferAfter(
              String(Math.floor(bufferAfterMin / 60) * 60 + next),
            )
          }
          labelPrefix="Перерыв после услуги"
        />
      </View>
    </View>
  ) : (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 10 }}>
      <Pressable
        onPress={() => {
          setHasBufferAfter(true);
          // Пятнадцать минут — самый частый перерыв: дорога внутри города
          // и разгрузка. Ноль означал бы «параметр есть, но не работает».
          if (Number(bufferAfter) <= 0) setBufferAfter("15");
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Добавить перерыв после услуги"
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          paddingVertical: 4,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
        >
          ＋ Перерыв после услуги
        </Text>
      </Pressable>
    </View>
  );
}
