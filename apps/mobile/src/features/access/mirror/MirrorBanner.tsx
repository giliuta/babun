import { Pressable, Text, View } from "react-native";
import {
  SafeAreaInsetsContext,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Eye } from "lucide-react-native";
import { TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useMirror, useMirrorMode } from "./mirror-state";
import type { ReactNode } from "react";

// ПЛАШКА ЗЕРКАЛА — ЕДИНСТВЕННЫЙ ПРИЗНАК РЕЖИМА И ЕДИНСТВЕННЫЙ ВЫХОД.
//
// Правило взято у Power BI («Now viewing as …» с кнопкой выхода) и Salesforce
// («Login as»): человек всегда должен видеть, что смотрит не своими глазами, и
// выйти одним касанием из любого экрана. Поэтому плашка живёт в КОРНЕ
// приложения, над всеми маршрутами: в какой бы раздел владелец ни ушёл —
// во вкладки, в запись, в счета, в карточку клиента по ссылке — она едет с
// ним. Стояла она внутри вкладок, и соседние экраны оставались в режиме без
// признака и без выхода.
//
// ВЫХОД — ВСЯ ПЛАШКА, а не только слово «Выйти». Она живёт наверху (иначе
// перекрывала бы нижнее действие каждого экрана), а до верхнего угла палец
// одной руки тянется с перехватом: промах по маленькой цели стоил бы второго
// движения. Слово остаётся — оно называет, что произойдёт.
//
// Вторая строка говорит честную границу: права его, данные ваши. Сервер
// отдаёт строки по токену владельца, и это не притворство зеркала, а его
// предел — тот же, который Power BI называет прямо в своей документации.
// Писать приложение в этом режиме не может вовсе (`sync/write-guard.ts`).

export function MirrorBanner({ inModal = false }: { inModal?: boolean } = {}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const { mirror, exit } = useMirrorMode();
  if (!mirror) return null;
  // ЛИСТ НА ВЕСЬ ЭКРАН — ОТДЕЛЬНОЕ ОКНО, И КОРНЕВАЯ ПЛАШКА ПОД НИМ НЕ ВИДНА.
  // Поэтому такие листы рисуют её у себя первым ребёнком. Вырез там свой:
  // контекст под корнем уже обнулён шимом (`MirrorInsetShim`), и взять его
  // значило бы прижать плашку к статус-бару.
  const top = inModal ? (initialWindowMetrics?.insets.top ?? insets.top) : insets.top;
  const where = mirror.calendarName ? ` · ${mirror.calendarName}` : "";
  return (
    <Pressable
      onPress={exit}
      accessibilityRole="button"
      accessibilityLabel="Выйти из просмотра чужими глазами"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        // Плашка стоит НАД экранами, то есть первой под статус-баром: верхний
        // вырез её, а не их. Экраны ниже свой `edges={["top"]}` при этом
        // считают от плашки и лишнего отступа не добавляют.
        paddingTop: top + 8,
        paddingBottom: 10,
        backgroundColor: t.accent,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Eye color={t.onAccent} size={18} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.callout, color: t.onAccent }}>
          {`Смотрите глазами: ${mirror.name}${where}`}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ ...TYPE.subhead, color: t.onAccent, opacity: 0.85 }}
        >
          Права его, данные ваши
        </Text>
      </View>
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.onAccent,
        }}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.callout, color: t.onAccent }}>
          Выйти
        </Text>
      </View>
    </Pressable>
  );
}

/** Пока зеркало включено, верхний вырез уже съеден плашкой: экранам под ней
 *  он объявляется нулевым, иначе каждый из них добавит свой и между плашкой и
 *  шапкой встанет пустая полоса. Вне режима — обычные вырезы устройства. */
export function MirrorInsetShim({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const mirror = useMirror();
  if (!mirror) return <>{children}</>;
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
