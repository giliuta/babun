import { useState, type ComponentType } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Archive,
  Check,
  ChevronRight,
  Download,
  Eye,
  MessageCircle,
  Tags,
  Upload,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  cardFieldsSummary,
  DEFAULT_CARD_FIELDS,
  useCardFields,
} from "@/features/clients/card-prefs";
import {
  offeredChannels,
  useEnabledChannels,
  useToggleChannel,
} from "@/features/clients/contact-channels";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useClients, useClientTags } from "@/features/clients/queries";

// v811 — «Настройки клиентов». Открывается шестерёнкой из хедера списка
// (порт web ClientsSettingsScreen). Группы:
//   • Отображение — Что показывать (live card-fields) · Теги клиентов.
//     Сортировка ЗДЕСЬ НЕ живёт: она первая строка листа «Фильтры»
//     (решение владельца 2026-07-25), персист в sort-pref.ts.
//   • Данные — Импорт CSV (мастер ImportWizardSheet: выбор файла →
//     маппинг колонок → превью+валидация → импорт с прогрессом/резюмом).
//     Экспорт CSV выполняется через системный share sheet.

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

function Row({
  tile,
  icon: Icon,
  title,
  sub,
  onPress,
}: {
  tile: string;
  icon: IconType;
  title: string;
  sub?: string;
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
        </View>
        {sub ? (
          <Text
            className="mt-px text-xs"
            style={{ color: t.faint }}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

export default function ClientsSettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields();
  const clientsQuery = useClients();
  const tagsQuery = useClientTags();
  const clients = clientsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const t = useThemeColors();
  // Способы связи: у одного бизнеса весь Кипр в WhatsApp, у другого Viber —
  // лишние каналы только удлиняют мини-лист на карточке.
  const { data: channels = [] } = useEnabledChannels();
  const toggleChannel = useToggleChannel();
  const [channelsOpen, setChannelsOpen] = useState(false);

  // Возврат на список с nonce-параметром — index открывает нужный шит.
  const backToList = (param: "openImport") =>
    router.navigate({
      pathname: "/clients",
      params: { [param]: String(Date.now()) },
    });

  const exportAll = async () => {
    try {
      if (clientsQuery.isLoading || tagsQuery.isLoading) {
        toast("Данные клиентов ещё загружаются", "info");
        return;
      }
      let exportClients = clients;
      let exportTags = tags;
      if (clientsQuery.isError || tagsQuery.isError) {
        const [clientResult, tagResult] = await Promise.all([
          clientsQuery.refetch(),
          tagsQuery.refetch(),
        ]);
        if (clientResult.error) throw clientResult.error;
        if (tagResult.error) throw tagResult.error;
        exportClients = clientResult.data ?? [];
        exportTags = tagResult.data ?? [];
      }
      if (exportClients.length === 0) {
        toast("Нет клиентов для выгрузки", "info");
        return;
      }
      const shared = await shareClientsCsv(exportClients, exportTags);
      if (shared)
        toast(`Выгружено клиентов: ${exportClients.length}`, "success");
    } catch (error) {
      toast(
        (error as Error).message || "Не удалось выгрузить клиентов",
        "error",
      );
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Настройки клиентов" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <SectionEyebrow>Отображение</SectionEyebrow>
        <SectionCard>
          <Row
            tile="#2F6FD6"
            icon={Eye}
            title="Что показывать на карточке"
            sub={cardFieldsSummary(prefs)}
            onPress={() => router.push("/clients/card-fields")}
          />
          <Divider inset={56} />
          <Row
            tile="#1F7A44"
            icon={MessageCircle}
            title="Способы связи"
            sub={offeredChannels().filter((c) => channels.includes(c.id))
              .map((c) => c.label)
              .join(" · ")}
            onPress={() => setChannelsOpen(true)}
          />
          <Divider inset={56} />
          <Row
            tile="#8E44AD"
            icon={Tags}
            title="Теги клиентов"
            sub={
              tagsQuery.isLoading
                ? "Загрузка…"
                : tagsQuery.isError
                  ? "Не удалось загрузить"
                  : tags.length > 0
                    ? `Создано: ${tags.length}`
                    : "Создать первый тег"
            }
            onPress={() => router.push("/clients/tags")}
          />
        </SectionCard>

        <SectionEyebrow>Данные</SectionEyebrow>
        <SectionCard>
          <Row
            tile="#2F6FD6"
            icon={Upload}
            title="Импорт из CSV"
            sub="Загрузить клиентов из файла"
            onPress={() => backToList("openImport")}
          />
          <Divider inset={56} />
          <Row
            tile="#2E7D32"
            icon={Download}
            title="Выгрузить всех клиентов"
            sub={
              clientsQuery.isLoading
                ? "Загрузка…"
                : clientsQuery.isError
                  ? "Повторить загрузку и выгрузить"
                  : `${clients.length} в CSV`
            }
            onPress={() => void exportAll()}
          />
          <Divider inset={56} />
          <Row
            tile="#5B6678"
            icon={Archive}
            title="Архив клиентов"
            sub="Просмотреть и восстановить"
            onPress={() => router.push("/clients/archive")}
          />
        </SectionCard>
      </ScrollView>

      {/* Какие каналы предлагать в мини-листе «Как связаться» на карточке.
          «Позвонить» не отключается: без него кнопка теряет смысл. */}
      <BottomSheet visible={channelsOpen} onClose={() => setChannelsOpen(false)}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
          >
            Способы связи
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ marginTop: 2, fontSize: 13, color: t.faint }}
          >
            Что предлагать в карточке клиента
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: 28 }}>
          <View
            style={{
              borderRadius: 12,
              overflow: "hidden",
              backgroundColor: t.rowFill,
            }}
          >
            {offeredChannels().map((c, i) => {
              const on = channels.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    if (!c.optional) return;
                    haptics.tap();
                    toggleChannel.mutate(c.id);
                  }}
                  disabled={!c.optional}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !c.optional }}
                  accessibilityLabel={c.label}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 48,
                    paddingHorizontal: 16,
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: t.separator,
                    backgroundColor: pressed ? t.rowFillPressed : "transparent",
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{
                      flex: 1,
                      fontSize: 15,
                      fontWeight: "600",
                      color: c.optional ? t.ink : t.faint,
                    }}
                  >
                    {c.label}
                    {c.optional ? "" : " · всегда"}
                  </Text>
                  {on ? (
                    <Check color={t.accent} size={18} strokeWidth={2.6} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </BottomSheet>
    </Screen>
  );
}
