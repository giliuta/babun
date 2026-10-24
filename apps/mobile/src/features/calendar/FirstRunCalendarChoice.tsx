import { Text, View } from "react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";
import { TourTarget } from "@/components/tour/TourTarget";

// ПЕРВЫЙ ВХОД ВЛАДЕЛЬЦА: календаря ещё нет. Пустая сетка часов и одна кнопка
// «Создать календарь» внизу; кнопка открывает шторку с названием.
//
// ЭКРАН — ТОЛЬКО СЕТКА И КНОПКА: без плитки со значком, заголовка и
// абзаца-объяснения. Почему:
//   1. АБЗАЦ ОБЪЯСНЯЛ БЫ СЛОВО, КОТОРОЕ НЕ ТРЕБУЕТ ОБЪЯСНЕНИЯ. Кнопка
//      «Создать календарь» называет действие сама.
//   2. ЗНАЧОК КАЛЕНДАРЯ НА ВКЛАДКЕ «КАЛЕНДАРЬ» повторял бы то, что уже сказано
//      таб-баром и самой кнопкой.
//   3. СЕТКА, А НЕ ПУСТОЙ ФОН: человек видит, куда он пришёл, — это тот же
//      календарь, только без имени. Сетка нарисована, а не настоящая: без
//      календаря у неё нет ни часов, ни пояса, ни записей.
//
// Главное действие экрана живёт ВНИЗУ, в футере (канон 7.1): этим
// приложением пользуются стоя у сплит-системы, одной рукой.

const HOURS = Array.from({ length: 13 }, (_, i) => `${String(8 + i).padStart(2, "0")}:00`);
const HOUR_H = 64;

export function FirstRunCalendarChoice({ onCreate }: { onCreate: () => void }) {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      <View style={{ flex: 1, overflow: "hidden", paddingTop: 12 }} importantForAccessibility="no-hide-descendants">
        {HOURS.map((hour) => (
          <View key={hour} style={{ flexDirection: "row", alignItems: "flex-start", height: HOUR_H }}>
            <Text
              style={{ width: 52, textAlign: "right", fontSize: 11, color: t.muted, marginTop: -7 }}
              maxFontSizeMultiplier={1.2}
            >
              {hour}
            </Text>
            <View style={{ flex: 1, height: 0.5, backgroundColor: t.separator, marginLeft: 8 }} />
          </View>
        ))}
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <TourTarget id="calendar.first-create" shape="control">
          <GradientButton label="Создать календарь" onPress={onCreate} />
        </TourTarget>
      </View>
    </View>
  );
}
