import { type ComponentType } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronRight,
  Eye,
  Filter,
  List,
  Pencil,
  Upload,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { SORT_LABELS_LONG, type SortKey } from "@/features/clients/filter";
import {
  cardFieldsSummary,
  DEFAULT_CARD_FIELDS,
  useCardFields,
} from "@/features/clients/card-prefs";

// v811 — «Настройки клиентов». Открывается шестерёнкой из хедера списка
// (порт web ClientsSettingsScreen). Группы:
//   • Отображение — Что показывать (live card-fields) · Сортировка /
//     Фильтры (→ открывают панель «Фильтры» на списке)
//   • Редактирование — заглушки («скоро»)
//   • Данные — Импорт CSV (мастер ImportWizardSheet: выбор файла →
//     маппинг колонок → превью+валидация → импорт с прогрессом/резюмом).
//     Экспорт CSV на мобиле отложен (Волна 2 spec) — строки нет.

type IconType = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

function Row({
  tile,
  icon: Icon,
  title,
  sub,
  soon,
  onPress,
}: {
  tile: string;
  icon: IconType;
  title: string;
  sub?: string;
  soon?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[50px] flex-row items-center gap-3 px-4 py-2.5"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        className="h-7 w-7 items-center justify-center rounded-[7px]"
        style={{ backgroundColor: tile }}
      >
        <Icon color="#fff" size={16} strokeWidth={2} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="shrink text-[15px]"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {soon ? (
            <View
              className="rounded-full px-1.5 py-px"
              style={{ backgroundColor: t.disabledFill }}
            >
              <Text
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: t.faint }}
              >
                скоро
              </Text>
            </View>
          ) : null}
        </View>
        {sub ? (
          <Text className="mt-px text-xs" style={{ color: t.faint }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

function GroupLabel({ children }: { children: string }) {
  const t = useThemeColors();
  return (
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
      {children}
    </Text>
  );
}

export default function ClientsSettingsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields();
  // Текущая сортировка приходит параметром со списка — только для
  // подзаголовка строки (сама сортировка живёт в панели «Фильтры»).
  const { sort } = useLocalSearchParams<{ sort?: string }>();
  const sortKey: SortKey =
    sort && sort in SORT_LABELS_LONG ? (sort as SortKey) : "recent";

  // Возврат на список с nonce-параметром — index открывает нужный шит.
  const backToList = (param: "openFilters" | "openImport") =>
    router.navigate({
      pathname: "/clients",
      params: { [param]: String(Date.now()) },
    });

  const stub = () => toast("Раздел в разработке", "info");

  return (
    <Screen>
      <ScreenHeader title="Настройки клиентов" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <GroupLabel>Отображение</GroupLabel>
        <SectionCard>
          <Row
            tile="#3E88F7"
            icon={Eye}
            title="Что показывать на карточке"
            sub={cardFieldsSummary(prefs)}
            onPress={() => router.push("/clients/card-fields")}
          />
          <Divider inset={56} />
          <Row
            tile="#5E5CE6"
            icon={ArrowUpDown}
            title="Сортировка списка"
            sub={SORT_LABELS_LONG[sortKey]}
            onPress={() => backToList("openFilters")}
          />
          <Divider inset={56} />
          <Row
            tile="#30B0C7"
            icon={Filter}
            title="Фильтры списка"
            sub="Команда · метка · тег · период"
            onPress={() => backToList("openFilters")}
          />
        </SectionCard>

        <GroupLabel>Редактирование</GroupLabel>
        <SectionCard>
          <Row
            tile="#34C759"
            icon={Pencil}
            title="Какие поля можно редактировать"
            soon
            onPress={stub}
          />
          <Divider inset={56} />
          <Row
            tile="#FF9500"
            icon={List}
            title="Поля и блоки профиля"
            sub="Объекты · визиты · финансы · заметки"
            soon
            onPress={stub}
          />
        </SectionCard>

        <GroupLabel>Данные</GroupLabel>
        <SectionCard>
          <Row
            tile="#3E88F7"
            icon={Upload}
            title="Импорт из CSV"
            sub="Загрузить клиентов из файла"
            onPress={() => backToList("openImport")}
          />
        </SectionCard>

        <View
          className="mx-3 mt-4 flex-row items-start gap-2 rounded-xl px-3.5 py-3"
          style={{ backgroundColor: "rgba(255,149,0,0.10)" }}
        >
          <AlertTriangle color={t.warning} size={16} strokeWidth={2.2} />
          <Text
            className="flex-1 text-[13px] leading-snug"
            style={{ color: t.warning }}
          >
            Раздел в разработке. «Что показывать на карточке» уже работает —
            остальное настроим дальше.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
