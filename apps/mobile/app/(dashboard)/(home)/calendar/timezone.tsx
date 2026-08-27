import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Check, Search } from "lucide-react-native";
import { TIMEZONE_OPTIONS } from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  deviceZone,
  utcLabel,
  zoneClock,
} from "@/features/calendar/device-timezone";
import { tzLabel } from "@/features/calendar/setting-options";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";

// ЧАСОВОЙ ПОЯС — СТРАНИЦА, А НЕ ЛИСТ.
//
// Владелец 2026-08-27: «мне не нравится, что она открывается прям так
// сверху… время автоматически сделай как в iPhone, почему так сложно».
//
// Претензия закрыта не тем, что лист стал ниже, а тем, что снизу больше
// ничего не выезжает. Плюс закон канона §5: настройка — ВСЕГДА полноценная
// страница; лист = действие прямо сейчас, страница = набор или настройка.
//
// Замеры прежнего листа (iPhone 17, 402×874): панель занимала 787pt — 90%
// экрана, верхняя кромка в 28pt под часами. Внутри 55 строк = 4,2 экрана
// прокрутки, а выбранная зона стояла 23-й строкой, на 1078pt ниже сгиба:
// при открытии галки на экране не было ни одной.
//
// ПРИ ВКЛЮЧЁННОЙ АВТОМАТИКЕ СПИСКА НЕТ ВОВСЕ. Он схлопнут до одной строки —
// той, которая и есть ответ. Первым в глаза бьёт ответ, а не список.
//
// БАРАБАНА ЗДЕСЬ НЕТ И НЕ БУДЕТ. Он показывал ВРЕМЯ, а выбиралось
// СМЕЩЕНИЕ — 288 положений пары при 27 различимых ответах, колонка минут не
// влияла ни на что. Хуже: «своё время» сохранялось фиксированной зоной
// Etc/GMT±N, которая не знает перевода часов, и включение тумблера без
// единого поворота барабана молча меняло живую зону на фиксированную.
// 25 октября это сдвинуло бы сутки в кассе.
export default function TimezoneScreen() {
  const t = useThemeColors();
  const { data: settings } = useCalendarSettings();
  const save = useSaveCalendarSettings();
  const [query, setQuery] = useState("");

  const zone = settings?.timezone ?? deviceZone();
  const auto = settings?.timezoneAuto ?? false;
  const phone = deviceZone();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = TIMEZONE_OPTIONS.includes(zone)
      ? TIMEZONE_OPTIONS
      : [...TIMEZONE_OPTIONS, zone];
    if (!q) return all;
    return all.filter((z) => tzLabel(z).toLowerCase().includes(q));
  }, [query, zone]);

  const row = (z: string, showCheck: boolean) => (
    <Pressable
      key={z}
      onPress={() => {
        if (auto) return;
        save.mutate({ timezone: z, timezoneAuto: false });
        router.back();
      }}
      disabled={auto}
      accessibilityRole="radio"
      accessibilityState={{ selected: z === zone, disabled: auto }}
      accessibilityLabel={`${tzLabel(z)}, ${utcLabel(z)}, сейчас ${zoneClock(z)}`}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: pressed && !auto ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: "500", color: t.ink }}
        >
          {tzLabel(z)}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
        >
          {utcLabel(z)}
        </Text>
      </View>
      {/* ЧАСЫ В КАЖДОЙ СТРОКЕ. Человек не обязан помнить, как называется его
          зона, но он ТОЧНО знает, сколько сейчас на его часах. Сверить
          глазами быстрее, чем вспомнить имя. Моноширинно — иначе столбец
          времени пляшет при прокрутке. */}
      <Text
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: t.body,
          fontVariant: ["tabular-nums"],
        }}
      >
        {zoneClock(z)}
      </Text>
      {showCheck && z === zone ? (
        <Check color={t.accent} size={18} strokeWidth={2.5} />
      ) : null}
    </Pressable>
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Часовой пояс" subtitle="Календарь" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard>
          <SwitchRow
            label="Автоматически"
            hint={`С телефона: ${tzLabel(phone)}`}
            value={auto}
            onChange={(v) =>
              save.mutate(
                v
                  ? { timezone: phone, timezoneAuto: true }
                  : { timezoneAuto: false },
              )
            }
          />
        </SectionCard>

        <SectionEyebrow>Пояс</SectionEyebrow>
        {auto ? (
          // Список схлопнут до ОТВЕТА: одна строка, никакой прокрутки.
          <SectionCard>{row(zone, true)}</SectionCard>
        ) : (
          <>
            {/* Поиск БЕЗ автофокуса: клавиатура, выехавшая сама, съедает
                половину списка и заставляет её закрывать, чтобы посмотреть. */}
            <SectionCard>
              <View
                className="flex-row items-center"
                style={{ paddingHorizontal: 12, minHeight: 44, gap: 8 }}
              >
                <Search color={t.faint} size={18} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Найти город"
                  placeholderTextColor={t.placeholder}
                  style={{ flex: 1, fontSize: 17, color: t.ink }}
                  autoCorrect={false}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
            </SectionCard>
            <View style={{ marginTop: 8, marginHorizontal: GUTTER }}>
              <SectionCard>
                {list.length === 0 ? (
                  <View style={{ padding: 24, alignItems: "center" }}>
                    <Text style={{ fontSize: 15, color: t.sub }}>
                      Ничего не найдено
                    </Text>
                  </View>
                ) : (
                  list.map((z) => row(z, true))
                )}
              </SectionCard>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
