import { Fragment } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Info } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
  useToggleCardField,
  type CardField,
} from "@/features/clients/card-prefs";

// v811 — «Что показывать на карточке». Вложенный экран под «Настройками
// клиентов» (порт web CardFieldsScreen). Тоггл пишет в MMKV и обновляет
// query — карточки списка меняются сразу. Имя всегда видно (замок).

interface FieldRow {
  /** null = всегда включённая строка «Имя клиента». */
  field: CardField | null;
  label: string;
  sub?: string;
  dot: (t: ThemeColors) => string;
}

// v811 gold — тот же литерал, что и на карточке (долг).
const ROWS: FieldRow[] = [
  { field: null, label: "Имя клиента", sub: "всегда видно", dot: (t) => t.faint },
  { field: "phone", label: "Телефон", sub: "под именем", dot: (t) => t.faint },
  { field: "exp", label: "Ожидаемая прибыль", sub: "серая", dot: (t) => t.sub },
  { field: "inc", label: "Доход", sub: "зелёный", dot: (t) => t.success },
  { field: "debt", label: "Долг", sub: "жёлтый", dot: (t) => t.warning },
  { field: "last", label: "Последняя запись", dot: (t) => t.faint },
  { field: "meta", label: "Команда, метка, теги", dot: (t) => t.faint },
];

export default function CardFieldsScreen() {
  const t = useThemeColors();
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields();
  const toggle = useToggleCardField();

  return (
    <Screen>
      <ScreenHeader title="Что показывать" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <Text
          style={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 4,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          Поля карточки
        </Text>
        <SectionCard>
          {ROWS.map((r, i) => {
            const locked = r.field === null;
            const on = r.field === null ? true : prefs[r.field];
            return (
              <Fragment key={r.label}>
                {i > 0 ? <Divider inset={44} /> : null}
                <View className="min-h-[50px] flex-row items-center gap-3 px-4 py-2">
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: r.dot(t),
                    }}
                  />
                  <View className="flex-1">
                    <Text className="text-[15px]" style={{ color: t.ink }}>
                      {r.label}
                    </Text>
                    {r.sub ? (
                      <Text className="mt-px text-xs" style={{ color: t.faint }}>
                        {r.sub}
                      </Text>
                    ) : null}
                  </View>
                  <Switch
                    value={on}
                    disabled={locked}
                    onValueChange={() => {
                      if (locked || !r.field) return;
                      toggle.mutate(r.field);
                    }}
                    accessibilityLabel={r.label}
                    style={locked ? { opacity: 0.45 } : undefined}
                  />
                </View>
              </Fragment>
            );
          })}
        </SectionCard>

        <View
          className="mx-3 mt-4 flex-row items-start gap-2 rounded-[14px] px-3.5 py-3"
          style={{ backgroundColor: `${t.accent}14` }}
        >
          <Info color={t.accent} size={16} strokeWidth={2.2} />
          <Text
            className="flex-1 text-[13px] leading-snug"
            style={{ color: t.accent }}
          >
            Выключи поле — оно сразу пропадёт с карточек в списке. Имя всегда
            видно.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
