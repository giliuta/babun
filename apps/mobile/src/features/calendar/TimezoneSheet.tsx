import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Check, Search } from "lucide-react-native";
import { ZONE_GROUPS } from "@babun/shared/local/timezones";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { LoopWheelColumn, WHEEL_H } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { utcLabel, zoneClock } from "@/features/calendar/device-timezone";
import { tzLabel } from "@/features/calendar/setting-options";

// ЧАСОВОЙ ПОЯС — БАРАБАН НА ПОЛЭКРАНА, У КАЖДОГО КАЛЕНДАРЯ СВОЙ.
//
// Владелец 2026-08-27, тремя правками подряд:
//   1. «часовой пояс нужно сделать исключительно под этот вид календаря»;
//   2. «разбивка не по городам, а по часовым поясам»;
//   3. «не надо во весь экран открывать, а в половину, но тумблером-барабаном
//      можно крутить часовые пояса».
//
// Все три сошлись в одном: пока строк было 418 (по городу на строку), барабан
// был невозможен — 418 щелчков мимо цели. Как только зоны свелись в 59 групп
// по ПОВЕДЕНИЮ (см. `timezones.ts`: в одну группу только те, чьё смещение
// совпало во всех двенадцати месяцах), барабан стал короче списка часов в
// сутках, и лист ужался с 86% экрана до половины.
//
// Колонка `teams.timezone` существовала и раньше, и продукт уже читал её
// первой — `activeTeam?.timezone ?? calSettings?.timezone` в календаре, в
// записи и в напоминаниях. Не было ТОЛЬКО места, где её выставить.
//
// КНОПКИ «АВТОМАТИЧЕСКИ» ЗДЕСЬ НЕТ, И ЭТО ПРАВИЛЬНО. Она означала «следовать
// за телефоном», но салон не переезжает вместе с владельцем: улетел в Варшаву
// — часы салона на Кипре не сдвинулись. Зона телефона осталась ровно там, где
// полезна, — значением ПО УМОЛЧАНИЮ у нового календаря, а не режимом.
export function TimezoneSheet({
  visible,
  onClose,
  value,
  inherited,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  /** Пояс ЭТОГО календаря — уже разрешённый (свой либо унаследованный). */
  value: string;
  /** Своего пояса у календаря нет: значение пришло от компании. */
  inherited: boolean;
  onApply: (zone: string) => void;
}) {
  const t = useThemeColors();
  const { width } = useWindowDimensions();

  // Сохранённая зона может не совпасть со строкой представителя: телефон
  // отдаёт `Asia/Nicosia`, представителем группы стоит `Europe/Nicosia`.
  // Ищем по ГРУППЕ, а не по строке, иначе барабан встал бы на нулевую.
  const indexOfZone = (z: string) => {
    const i = ZONE_GROUPS.findIndex((g) => g.zone === z);
    if (i >= 0) return i;
    const city = z.split("/").pop()?.replace(/_/g, " ");
    const byCity = ZONE_GROUPS.findIndex((g) => city && g.cities.includes(city));
    return byCity >= 0 ? byCity : 0;
  };

  const [idx, setIdx] = useState(() => indexOfZone(value));
  const [query, setQuery] = useState("");

  // Лист живёт в дереве постоянно: без сброса он открылся бы во второй раз с
  // выбором, сделанным для ДРУГОГО календаря.
  useEffect(() => {
    if (visible) {
      setIdx(indexOfZone(value));
      setQuery("");
    }
  }, [visible, value]);

  const group = ZONE_GROUPS[idx] ?? ZONE_GROUPS[0];

  // СМЕЩЕНИЕ В СКОБКАХ ПРЯМО В СТРОКЕ БАРАБАНА (владелец 2026-08-27: «пиши в
  // скобках на часы пояса»). Оно и есть ответ на вопрос «на сколько я сдвину
  // сутки», а имя города — только способ его назвать.
  // СВОЙ ГОРОД В СВОЕЙ ЖЕ СТРОКЕ. Группа подписана одним городом из сорока,
  // и по умолчанию это не обязательно твой: кипрская зона называлась
  // «Helsinki (UTC+3)», и владелец на Кипре своей строки в барабане не
  // узнавал. Группу, в которой стоит ТЕКУЩАЯ зона, подписываем её городом.
  const ownCity = value.split("/").pop()?.replace(/_/g, " ");

  const items = useMemo(
    () =>
      ZONE_GROUPS.map((g) => {
        const name =
          ownCity && g.cities.includes(ownCity) ? ownCity : tzLabel(g.zone);
        return `${name} (${utcLabel(g.zone)})`;
      }),
    [ownCity],
  );

  // ПОИСК ИЩЕТ ПО ВСЕМ ГОРОДАМ ГРУППЫ, А НЕ ПО ЕЁ ПОДПИСИ. Группа названа
  // одним городом из сорока; человек набирает СВОЙ, и он обязан найтись.
  const q = query.trim().toLowerCase();
  const hits = q
    ? ZONE_GROUPS.map((g, i) => ({ g, i })).filter(({ g }) =>
        g.cities.some((c) => c.toLowerCase().includes(q)),
      )
    : [];

  // ПОКА ИЩУТ — БАРАБАНА НЕТ. Кольцо из двух-трёх значений показывает одну и
  // ту же строку во всех трёх рядах и читается как поломка; короткий список
  // отвечает прямо. Барабан возвращается, как только поле пустеет.
  const searching = q.length > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Часовой пояс"
      // Полэкрана: поиск, барабан, кнопка. Список на 86% высоты был здесь до
      // 27 августа — от него владелец и отказался.
      maxHeightRatio={0.5}
      footer={
        <View className="px-5">
          <Button
            label="Применить"
            onPress={() => {
              onApply(group.zone);
              onClose();
            }}
          />
        </View>
      }
    >
      {inherited ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            paddingHorizontal: GUTTER,
            paddingBottom: 6,
            fontSize: 13,
            lineHeight: 18,
            color: t.sub,
            textAlign: "center",
          }}
        >
          Пояс этого календаря. Остальные не изменятся.
        </Text>
      ) : null}

      <View style={{ paddingHorizontal: GUTTER }}>
        <View
          className="flex-row items-center"
          style={{
            paddingHorizontal: 12,
            minHeight: 44,
            gap: 8,
            borderRadius: t.radius.input,
            backgroundColor: t.canvas,
          }}
        >
          <Search color={t.faint} size={18} />
          {/* Без автофокуса: выехавшая сама клавиатура съедает пол-листа. */}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Найти город"
            placeholderTextColor={t.placeholder}
            style={{ flex: 1, fontSize: 17, color: t.ink }}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {searching ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 4 * 52, marginTop: 10 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}
        >
          {hits.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={{ fontSize: 15, color: t.sub }}>Ничего не найдено</Text>
            </View>
          ) : (
            hits.map(({ g, i }) => (
              <Pressable
                key={g.zone}
                onPress={() => {
                  setIdx(i);
                  setQuery("");
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: i === idx }}
                accessibilityLabel={`${tzLabel(g.zone)}, ${utcLabel(g.zone)}, сейчас ${zoneClock(g.zone)}`}
                style={({ pressed }) => ({
                  height: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 12,
                  borderRadius: t.radius.card,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ fontSize: 17, color: t.ink }}
                  >
                    {/* Показываем ТОТ город, который набрали, а не подпись
                        группы: иначе на «tbilisi» отвечает «Dubai». */}
                    {g.cities.find((c) => c.toLowerCase().includes(q)) ??
                      tzLabel(g.zone)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                  >
                    {utcLabel(g.zone)}
                  </Text>
                </View>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: t.sub,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {zoneClock(g.zone)}
                </Text>
                {i === idx ? (
                  <Check color={t.accent} size={18} strokeWidth={2.5} />
                ) : (
                  <View style={{ width: 18 }} />
                )}
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : (
        <View style={{ alignItems: "center", marginTop: 12 }}>
          {/* БАРАБАН И БОЛЬШЕ НИЧЕГО (владелец 2026-08-27: «время это стабильная
              13:59 — убирай; внизу Хельсинки, Бухарест — тоже убирай; зачем
              подсвечивать вот эту всю хуету»).

              Все три претензии верны, и первая была БАГОМ, а не вкусом: часы
              считались один раз при отрисовке и не тикали, поэтому стояли на
              одном значении и врали. Чинить их тикером ради строки, которая и
              так дублирует смещение из барабана, — плата за нулевую пользу.

              Перечень соседних городов ушёл следом: он нужен был, чтобы найти
              свой город, а для этого есть ПОИСК — он ищет по всем городам
              группы и отвечает тем, который набрали.

              Подложки под барабаном тоже нет: серая плашка тонировала половину
              листа и читалась как выделение, хотя выделять здесь нечего —
              барабан и так единственный контрол на экране. */}
          {/* Высота задана ЗДЕСЬ, а не отдана барабану: своей он не удержал —
              лента растянулась на семь рядов, распёрла лист и вытолкнула
              «Применить» за кромку экрана. Обрезаем сами, без фона. */}
          <View style={{ height: WHEEL_H, marginBottom: 12, overflow: "hidden" }}>
            <LoopWheelColumn
              items={items}
              value={idx}
              onChange={setIdx}
              accessibilityLabel="Часовой пояс"
              width={Math.min(width - GUTTER * 2, 340)}
              fontSize={19}
            />
          </View>
        </View>
      )}

    </BottomSheet>
  );
}
