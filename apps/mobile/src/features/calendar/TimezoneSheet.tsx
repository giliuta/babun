import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Search } from "lucide-react-native";
import { ZONE_GROUPS } from "@babun/shared/local/timezones";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ITEM_H, LoopWheelColumn } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { utcLabel } from "@/features/calendar/device-timezone";
import {
  NAMES_IN_LABEL,
  zoneGroupIndexOf,
} from "@/features/calendar/zone-label";

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

// ОДНА СТРОКА НА ДВА РЕЖИМА — БАРАБАН И ПОИСК (владелец 2026-08-27: «когда
// прописываю Киев, получается Киев слева, справа само время — сделай так же,
// если даже не прописываешь»).
//
// До этого барабан центрировал «города · смещение» одним блоком, а поиск
// раскидывал их по краям: два разных ритма на одном листе, и переход из
// одного в другой читался как переход на другой экран. Теперь раскладка одна:
// города слева, смещение справа по правому краю.
//
// Правый край и есть смысл: смещения выстраиваются в СТОЛБЕЦ и читаются
// сверху вниз одним движением глаза. При центрировании «UTC+2», «UTC+3»,
// «UTC+3:30» начинались с разного места, и сравнить их было нельзя.
function zoneRow({
  t,
  cities,
  offset,
  active,
}: {
  t: ReturnType<typeof useThemeColors>;
  cities: string;
  offset: string;
  active: boolean;
}) {
  return (
    <View
      className="flex-row items-center"
      style={{ width: "100%", paddingHorizontal: 14, gap: 10 }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: active ? 17 : 15,
          fontWeight: active ? "600" : "400",
          letterSpacing: -0.2,
          color: active ? t.ink : t.placeholder,
        }}
      >
        {cities}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: active ? 14 : 13,
          fontWeight: "500",
          color: active ? t.sub : t.faint,
          fontVariant: ["tabular-nums"],
        }}
      >
        {offset}
      </Text>
    </View>
  );
}

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

  const [idx, setIdx] = useState(() => zoneGroupIndexOf(value));
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
    setIdx(zoneGroupIndexOf(value));
    setQuery("");
    setPicked(null);
  }, [visible, value]);

  const group = ZONE_GROUPS[idx] ?? ZONE_GROUPS[0];

  // Свой город — первым в подписи СВОЕЙ группы. Иначе киевлянин видел бы
  // «(UTC+2) Helsinki, Athens, Nicosia» и не понимал, что строка про него.
  const ownCity = value.split("/").pop()?.replace(/_/g, " ");
  // СТРОКА СОБИРАЕТСЯ ИЗ ДВУХ КУСКОВ РАЗНОЙ ВАЖНОСТИ. Города — то, по чему
  // человек себя узнаёт; смещение — справка. Одним кеглем и в скобках они
  // спорили: «(UTC+3) Nicosia, Kyiv, Helsinki» читалось как техническая
  // надпись, а не как «мой пояс». Теперь город идёт первым и весом, а
  // смещение — мельче и приглушённым, за тонким разделителем.
  const rows = useMemo(
    () =>
      ZONE_GROUPS.map((g) => {
        const names = g.cities.map((c) => c.name);
        const own = ownCity && names.includes(ownCity) ? ownCity : null;
        const head = own ? [own, ...names.filter((n) => n !== own)] : names;
        return {
          cities: head.slice(0, NAMES_IN_LABEL).join(", "),
          offset: utcLabel(g.zone),
        };
      }),
    [ownCity],
  );

  // `items` остаются строками: их произносит VoiceOver, и по ним же барабан
  // считает свою длину.
  const items = useMemo(
    () => rows.map((r) => `${r.cities}, ${r.offset}`),
    [rows],
  );

  // ПОИСК ИЩЕТ ПО ВСЕМ ГОРОДАМ ГРУППЫ, А НЕ ПО ПОДПИСИ: в подпись попадают
  // три из сорока, а человек набирает свой.
  const q = query.trim().toLowerCase();
  // НАЧАЛО СЛОВА ВПЕРЁД. Подстрока сама по себе даёт мусор в голове списка:
  // на «ki» первым выпадал «Rankin Inlet», а человек набирал Kigali, Kinshasa
  // или Kirov. Совпадения с начала имени идут первыми, остальные — следом,
  // и внутри каждой пачки сохраняется порядок с запада на восток.
  const hits = q
    ? ZONE_GROUPS.flatMap((g, i) =>
        g.cities
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({
            city: c,
            groupIndex: i,
            starts: c.name.toLowerCase().startsWith(q),
          })),
      )
        .sort((a, b) => Number(b.starts) - Number(a.starts))
        .slice(0, 40)
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
                  accessibilityLabel={`${city.name}, ${utcLabel(city.zone)}`}
                  style={({ pressed }) => ({
                    height: ITEM_H,
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    // ТА ЖЕ ПОЛОСА, ЧТО ПОД СРЕЗОМ БАРАБАНА. Владелец: «он
                    // просто слегка подсвечивается». Галочки здесь нет
                    // намеренно — она была бы вторым сообщением об одном.
                    backgroundColor: pressed
                      ? t.pressed
                      : active
                        ? t.canvas
                        : "transparent",
                  })}
                >
                  {zoneRow({
                    t,
                    cities: city.name,
                    offset: utcLabel(city.zone),
                    active: true,
                  })}
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
            {/* ПОЛОСА ВЫБОРА — ПОД ОДНОЙ СТРОКОЙ, А НЕ ПОД ВСЕМ БАРАБАНОМ.
                Ровно этим системный пикер и отличается от столбика текста:
                видно, ГДЕ срез. Прежняя серая плита во весь блок тонировала
                пол-листа и читалась как выделение всего сразу — её владелец
                и снёс 27 августа. Здесь заливка лежит на одной строке,
                скруглена и не ловит касания. */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: ((WHEEL_ROWS - 1) / 2) * ITEM_H,
                height: ITEM_H,
                borderRadius: t.radius.card,
                backgroundColor: t.canvas,
              }}
            />
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
              rows={WHEEL_ROWS}
              renderItem={(_label, active, i) => {
                const r = rows[i] ?? rows[0];
                return zoneRow({
                  t,
                  cities: r.cities,
                  offset: r.offset,
                  active,
                });
              }}
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
