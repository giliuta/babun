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
import { ITEM_H, LoopWheelColumn } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { utcLabel, zoneClock } from "@/features/calendar/device-timezone";

// ЧАСОВОЙ ПОЯС — БАРАБАН НА ПОЛЭКРАНА, У КАЖДОГО КАЛЕНДАРЯ СВОЙ.
//
// Колонка `teams.timezone` в базе была всегда, и продукт уже читал её ПЕРВОЙ
// (`activeTeam?.timezone ?? calSettings?.timezone` в календаре, в записи, в
// напоминаниях). Не было только места, где её выставить.
//
// СТРОКА ПИШЕТСЯ КАК В НАСТРОЙКАХ ТЕЛЕФОНА: `(UTC+2) Kyiv, Helsinki, Athens` —
// сначала смещение, потом города через запятую. Владелец 2026-08-27:
// «некоторые будут жить в Киеве, у них такое же… чтоб было всё указано чётко
// и без всяких „либо"». До этого строка звалась одним городом-представителем,
// и киевлянин своей строки не находил вовсе: группа называлась «Helsinki».
//
// БАРАБАН НА СЕМЬ СТРОК (владелец: «три сверху, три снизу и посередине одна»).
// На трёх строках из 61 группы не видно, куда крутить.
//
// КНОПКИ «АВТОМАТИЧЕСКИ» ЗДЕСЬ НЕТ, И ЭТО ПРАВИЛЬНО. Она означала «следовать
// за телефоном», но салон не переезжает вместе с владельцем: улетел в Варшаву
// — часы салона на Кипре не сдвинулись. Зона телефона осталась там, где
// полезна, — значением по умолчанию у нового календаря, а не режимом.
//
// ЧАСОВ ЗДЕСЬ ТОЖЕ НЕТ. Строка «14:02» считалась один раз при отрисовке и не
// тикала — застревала и через минуту врала. Смещение уже написано в самой
// строке барабана, и время из него выводится однозначно.

/** Строк видно разом: три сверху, выбранная, три снизу. */
const WHEEL_ROWS = 7;

/** Сколько городов помещается в подпись, не обрезаясь на 340pt. */
const NAMES_IN_LABEL = 3;

export function TimezoneSheet({
  visible,
  onClose,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  /** Пояс ЭТОГО календаря — уже разрешённый (свой либо унаследованный). */
  value: string;
  onApply: (zone: string) => void;
}) {
  const t = useThemeColors();
  const { width } = useWindowDimensions();

  // Сохранённая зона может не совпасть с представителем группы: телефон
  // отдаёт `Asia/Nicosia`, представителем стоит `Europe/Kyiv`. Ищем по
  // ГОРОДАМ группы, а не по одной строке, иначе барабан встал бы на нулевую.
  const indexOfZone = (z: string) => {
    const i = ZONE_GROUPS.findIndex((g) => g.cities.some((c) => c.zone === z));
    if (i >= 0) return i;
    const city = z.split("/").pop()?.replace(/_/g, " ");
    const byCity = ZONE_GROUPS.findIndex((g) =>
      g.cities.some((c) => c.name === city),
    );
    return byCity >= 0 ? byCity : 0;
  };

  const [idx, setIdx] = useState(() => indexOfZone(value));
  const [query, setQuery] = useState("");
  // Что уйдёт в базу. Барабан отдаёт представителя группы, поиск — зону
  // ВЫБРАННОГО города: киевлянину сохраняется `Europe/Kyiv`, а не
  // `Europe/Helsinki`. Сегодня они неразличимы, но правила перевода часов
  // меняют по странам, и украинский бизнес обязан жить по украинскому.
  const [picked, setPicked] = useState<string | null>(null);

  // Лист живёт в дереве постоянно: без сброса он открылся бы во второй раз с
  // выбором, сделанным для ДРУГОГО календаря.
  useEffect(() => {
    if (!visible) return;
    setIdx(indexOfZone(value));
    setQuery("");
    setPicked(null);
  }, [visible, value]);

  const group = ZONE_GROUPS[idx] ?? ZONE_GROUPS[0];

  // Свой город — первым в подписи СВОЕЙ группы. Иначе киевлянин видел бы
  // «(UTC+2) Helsinki, Athens, Nicosia» и не понимал, что строка про него.
  const ownCity = value.split("/").pop()?.replace(/_/g, " ");
  const items = useMemo(
    () =>
      ZONE_GROUPS.map((g) => {
        const names = g.cities.map((c) => c.name);
        const own = ownCity && names.includes(ownCity) ? ownCity : null;
        const head = own ? [own, ...names.filter((n) => n !== own)] : names;
        return `(${utcLabel(g.zone)}) ${head.slice(0, NAMES_IN_LABEL).join(", ")}`;
      }),
    [ownCity],
  );

  // ПОИСК ИЩЕТ ПО ВСЕМ ГОРОДАМ ГРУППЫ, А НЕ ПО ПОДПИСИ: в подпись попадают
  // три из сорока, а человек набирает свой.
  const q = query.trim().toLowerCase();
  const hits = q
    ? ZONE_GROUPS.flatMap((g, i) =>
        g.cities
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({ city: c, groupIndex: i })),
      ).slice(0, 40)
    : [];

  // ПОКА ИЩУТ — БАРАБАНА НЕТ. Кольцо из двух-трёх значений показывает одну и
  // ту же строку во всех рядах и читается как поломка; список отвечает прямо.
  const searching = q.length > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Часовой пояс"
      // Семь строк барабана (280pt) + поиск + кнопка. Список на 86% высоты
      // стоял здесь до 27 августа — от него владелец отказался.
      maxHeightRatio={0.66}
      footer={
        <View className="px-5">
          <Button
            label="Применить"
            onPress={() => {
              onApply(picked ?? group.zone);
              onClose();
            }}
          />
        </View>
      }
    >
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
          style={{ maxHeight: ITEM_H * WHEEL_ROWS, marginTop: 10 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}
        >
          {hits.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={{ fontSize: 15, color: t.sub }}>Ничего не найдено</Text>
            </View>
          ) : (
            hits.map(({ city, groupIndex }) => {
              const active = picked === city.zone;
              return (
                <Pressable
                  key={city.zone}
                  onPress={() => {
                    setIdx(groupIndex);
                    setPicked(city.zone);
                    setQuery("");
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${city.name}, ${utcLabel(city.zone)}, сейчас ${zoneClock(city.zone)}`}
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
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 17, color: t.ink }}
                  >
                    {city.name}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{ fontSize: 15, color: t.sub }}
                  >
                    {utcLabel(city.zone)}
                  </Text>
                  {active ? (
                    <Check color={t.accent} size={18} strokeWidth={2.5} />
                  ) : (
                    <View style={{ width: 18 }} />
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      ) : (
        <View style={{ alignItems: "center", marginTop: 8 }}>
          {/* Высота задана ЗДЕСЬ, а не отдана барабану: своей он не удержал —
              лента растянулась и вытолкнула «Применить» за кромку экрана. */}
          <View
            style={{
              height: ITEM_H * WHEEL_ROWS,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <LoopWheelColumn
              items={items}
              value={idx}
              onChange={(i) => {
                setIdx(i);
                // Крутанули барабан — выбор поиска отменён: сохраняем то, что
                // человек видит под срезом, а не то, что нажал минуту назад.
                setPicked(null);
              }}
              accessibilityLabel="Часовой пояс"
              width={Math.min(width - GUTTER * 2, 360)}
              fontSize={16}
              rows={WHEEL_ROWS}
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
