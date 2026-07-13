import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Pressable,
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
  const chipBg = t.fill;
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={{ backgroundColor: chipBg }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Минус час"
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
        accessibilityLabel="Плюс час"
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
    save.mutate(p, {
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

      <SectionEyebrow>Рабочие часы по умолчанию</SectionEyebrow>
      <SectionCard padded>
        <Row
          label="Начало"
          right={
            <Stepper
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

      <SectionEyebrow>Отображение</SectionEyebrow>
      <SectionCard padded>
        <Row
          label="Скрывать отменённые"
          right={
            <Switch
              value={!!s.hideCancelled}
              onValueChange={(v) => patch({ hideCancelled: v })}
              trackColor={{ true: t.accent }}
            />
          }
        />
      </SectionCard>
    </Screen>
  );
}
