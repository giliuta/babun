import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Minus, Plus } from "lucide-react-native";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";

// Eyebrow-заголовок секции НА канвасе (единый grouped-list-диалект хаба
// кабинета/финансов): caption-tier caps над карточкой, а не первой строкой
// внутри неё. Отступ 24 сверху / 8 снизу.
function SectionEyebrow({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      style={{
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 8,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
      }}
    >
      {children}
    </Text>
  );
}

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-1 py-2.5">
      <Text style={{ color: t.ink }} className="text-base">{label}</Text>
      {right}
    </View>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  /** Имя настройки для VoiceOver: на экране пять пар ± , без него все
   *  кнопки звучат одинаково («минус час») и неразличимы. */
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const t = useThemeColors();
  const chipBg = t.fill;
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={{ backgroundColor: chipBg }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}: минус час`}
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Minus color={t.body} size={16} />
      </Pressable>
      <Text style={{ color: t.ink }} className="w-14 text-center text-base font-semibold tabular-nums">
        {String(value).padStart(2, "0")}:00
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={{ backgroundColor: chipBg }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}: плюс час`}
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Plus color={t.body} size={16} />
      </Pressable>
    </View>
  );
}

// Степпер минут (±5) — буфер между записями. Тот же язык, что часовой
// Stepper выше, но с шагом 5 и подписью «N мин».
function MinuteStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(min, value - 5))}
        style={{ backgroundColor: t.fill }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Буфер: минус 5 минут"
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Minus color={t.body} size={16} />
      </Pressable>
      <Text style={{ color: t.ink }} className="w-16 text-center text-base font-semibold tabular-nums">
        {value} мин
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 5))}
        style={{ backgroundColor: t.fill }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Буфер: плюс 5 минут"
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Plus color={t.body} size={16} />
      </Pressable>
    </View>
  );
}

// «✓ Сохранено» у заголовка — тихий отклик instant-commit'а: тост на каждый
// тап степпера слишком шумный (перекрывает контент сверху), поэтому микро-
// индикатор в right-слоте ScreenHeader, гаснущий сам через ~1.5 с. Каждый
// новый tick переустанавливает таймер — серия быстрых тапов держит одну
// надпись, а не мигает.
function SavedIndicator({ tick }: { tick: number }) {
  const t = useThemeColors();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!tick) return;
    opacity.setValue(1);
    // Индикатор pointerEvents не ловит и гаснет сам — VoiceOver без
    // явного анонса не узнал бы, что настройка сохранилась (как в Toast).
    AccessibilityInfo.announceForAccessibility("Сохранено");
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }, 1500);
    return () => clearTimeout(timer);
  }, [tick, opacity]);
  if (!tick) return null;
  return (
    <Animated.Text
      style={{ opacity, fontSize: 13, fontWeight: "600", color: t.success }}
    >
      ✓ Сохранено
    </Animated.Text>
  );
}

// Каскадный кламп веба (settings/calendar/page.tsx, v448): часовые поля
// сохраняются не поодиночке, а согласованной пятёркой. Рабочие часы /
// «Открывается на» ВНЕ видимого диапазона расширяют его (ментальная модель
// «пикер даёт выбрать любой час»), сжатое видимое окно поджимает рабочую
// полосу внутрь. Без каскада однополевой патч сохранял бы противоречие,
// которое офлайн-санитайзер потом молча откатывает (флип-флоп значений
// онлайн/офлайн). Патчи без часовых полей проходят насквозь.
function cascadeHours(
  s: CalendarSettings,
  p: Partial<CalendarSettings>,
): Partial<CalendarSettings> {
  if (
    p.startHour === undefined &&
    p.endHour === undefined &&
    p.workStartHour === undefined &&
    p.workEndHour === undefined &&
    p.scrollOpenHour === undefined
  ) {
    return p;
  }
  const next = { ...s, ...p };

  // 1. Видимый диапазон ≥ 1 ч: инверсия двигает ПРОТИВОПОЛОЖНУЮ границу.
  if (next.endHour <= next.startHour) {
    if (p.startHour !== undefined) next.endHour = Math.min(24, next.startHour + 1);
    else if (p.endHour !== undefined) next.startHour = Math.max(0, next.endHour - 1);
  }

  // 2. Рабочие часы / «Открывается на» вне видимого — расширяют видимое.
  if (p.workStartHour !== undefined && p.workStartHour < next.startHour) {
    next.startHour = Math.max(0, p.workStartHour);
  }
  if (p.workEndHour !== undefined && p.workEndHour > next.endHour) {
    next.endHour = Math.min(24, p.workEndHour);
  }
  if (p.scrollOpenHour !== undefined) {
    if (p.scrollOpenHour < next.startHour) next.startHour = Math.max(0, p.scrollOpenHour);
    if (p.scrollOpenHour > next.endHour) next.endHour = Math.min(24, p.scrollOpenHour);
  }

  // 3. Рабочая полоса — внутри (возможно расширенного) видимого, минимум 1 ч.
  let ws = next.workStartHour ?? next.startHour;
  let we = next.workEndHour ?? next.endHour;
  ws = Math.max(next.startHour, Math.min(ws, next.endHour - 1));
  we = Math.min(next.endHour, Math.max(we, next.startHour + 1));
  if (we <= ws) {
    if (p.workStartHour !== undefined) we = Math.min(next.endHour, ws + 1);
    else ws = Math.max(next.startHour, we - 1);
  }

  // 4. «Открывается на» — внутри видимого; без явного значения — workStart.
  const open = Math.max(next.startHour, Math.min(next.scrollOpenHour ?? ws, next.endHour));

  return {
    ...p,
    startHour: next.startHour,
    endHour: next.endHour,
    workStartHour: ws,
    workEndHour: we,
    scrollOpenHour: open,
  };
}

export default function CalendarSettingsScreen() {
  const t = useThemeColors();
  const { data: settings } = useCalendarSettings();
  const save = useSaveCalendarSettings();
  // Тик последнего успешного коммита — кормит SavedIndicator.
  const [savedTick, setSavedTick] = useState(0);
  const s: CalendarSettings = settings ?? DEFAULT_CALENDAR_SETTINGS;

  // Instant-commit (web parity — «Мой календарь» в вебе тоже без кнопки):
  // каждый контрол шлёт частичный патч сразу. Мутация и так targeted
  // (updateCalendarSettings пишет поле-в-поле), так что незагруженные /
  // web-managed поля дефолтами не затираются. До резолва запроса патчи
  // игнорируем: контролы ещё показывают неподтверждённые дефолты, и «+1»
  // степпера записал бы значение не от той базы.
  const patch = (p: Partial<CalendarSettings>) => {
    if (!settings) return;
    save.mutate(cascadeHours(s, p), {
      onSuccess: () => setSavedTick(Date.now()),
      onError: (e) => Alert.alert("Ошибка", e.message),
    });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Календарь"
        right={<SavedIndicator tick={savedTick} />}
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <SectionEyebrow>Видимое время</SectionEyebrow>
        <SectionCard padded>
          <Row
            label="Начало"
            right={
              <Stepper
                label="Видимое время, начало"
                value={s.startHour ?? 0}
                min={0}
                max={(s.endHour ?? 24) - 1}
                onChange={(v) => patch({ startHour: v })}
              />
            }
          />
          <Divider />
          <Row
            label="Конец"
            right={
              <Stepper
                label="Видимое время, конец"
                value={s.endHour ?? 24}
                min={(s.startHour ?? 0) + 1}
                max={24}
                onChange={(v) => patch({ endHour: v })}
              />
            }
          />
          <Divider />
          <Row
            label="Открывается на"
            right={
              <Stepper
                label="Открывается на"
                // Фолбэк как в календаре (index.tsx scrollToHour):
                // scrollOpenHour → workStartHour → 9, иначе экран
                // показывал бы час, на который сетка не откроется.
                value={Math.min(
                  Math.max(
                    s.scrollOpenHour ?? s.workStartHour ?? 9,
                    s.startHour ?? 0,
                  ),
                  (s.endHour ?? 24) - 1,
                )}
                min={s.startHour ?? 0}
                max={(s.endHour ?? 24) - 1}
                onChange={(v) => patch({ scrollOpenHour: v })}
              />
            }
          />
        </SectionCard>
        <SectionFooter>
          Какие часы показывает сетка. «Открывается на» — час, который стоит
          сверху при входе в календарь. У команды со своими значениями
          (шестерёнка календаря) действуют её значения.
        </SectionFooter>

        <SectionEyebrow>Рабочие часы по умолчанию</SectionEyebrow>
        <SectionCard padded>
          <Row
            label="Начало"
            right={
              <Stepper
                label="Рабочие часы, начало"
                value={s.workStartHour ?? 6}
                min={0}
                max={(s.workEndHour ?? 22) - 1}
                onChange={(v) => patch({ workStartHour: v })}
              />
            }
          />
          <Divider />
          <Row
            label="Конец"
            right={
              <Stepper
                label="Рабочие часы, конец"
                value={s.workEndHour ?? 22}
                min={(s.workStartHour ?? 6) + 1}
                max={24}
                onChange={(v) => patch({ workEndHour: v })}
              />
            }
          />
        </SectionCard>
        <SectionFooter>
          У команды с собственным расписанием действует её расписание
          (шестерёнка календаря).
        </SectionFooter>

        <SectionEyebrow>Шаг сетки</SectionEyebrow>
        <SectionCard padded>
          <SegmentedControl
            options={[
              { value: "15", label: "15 мин" },
              { value: "30", label: "30 мин" },
              { value: "60", label: "60 мин" },
            ]}
            value={String(s.gridStep) as "15" | "30" | "60"}
            onChange={(v) => patch({ gridStep: Number(v) as 15 | 30 | 60 })}
          />
        </SectionCard>

        <SectionEyebrow>Буфер между записями</SectionEyebrow>
        <SectionCard padded>
          <Row
            label="Минимальный зазор"
            right={
              <MinuteStepper
                value={s.bufferMinutes ?? 0}
                min={0}
                max={120}
                onChange={(v) => patch({ bufferMinutes: v })}
              />
            }
          />
        </SectionCard>
        <SectionFooter>
          Зазор после каждой записи подсвечивается на сетке серым — время на
          дорогу и уборку.
        </SectionFooter>

        <SectionEyebrow>Отображение</SectionEyebrow>
        <SectionCard padded>
          <Row
            label="Скрывать отменённые"
            right={
              <Switch
                value={!!s.hideCancelled}
                onValueChange={(v) => patch({ hideCancelled: v })}
                trackColor={{ true: t.accent }}
                accessibilityLabel="Скрывать отменённые"
              />
            }
          />
        </SectionCard>
        <SectionFooter>
          Если у активной команды задано своё «Скрывать отменённые»
          (шестерёнка календаря), действует настройка команды.
        </SectionFooter>
      </ScrollView>
    </Screen>
  );
}
