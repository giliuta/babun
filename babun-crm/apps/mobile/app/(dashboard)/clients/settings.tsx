import type { ComponentType } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Archive,
  ChevronRight,
  Download,
  Eye,
  Home,
  MessageCircle,
  Navigation,
  Tags,
  Smartphone,
  Upload,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { CONTACTS_AVAILABLE } from "@/features/clients/import/ContactsImportSheet";
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
} from "@/features/clients/contact-channels";
import { useEnabledContactFields } from "@/features/clients/contact-fields";
import {
  mapServicesSummary,
  useEnabledMapServices,
} from "@/lib/map-services";
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
        className="h-7 w-7 items-center justify-center rounded-[14px]"
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
  // Способы связи: у одного бизнеса весь Кипр в WhatsApp, у другого Viber —
  // лишние каналы только удлиняют мини-лист на карточке.
  const channels = useEnabledChannels();
  // Карты для маршрута: у кого-то весь навигатор — Google, и Яндекс в листе
  // только удлиняет каждый выезд (владелец 2026-08-02).
  const mapServices = useEnabledMapServices();
  // Что предлагать в листе «Добавить» на карточке (шестерёнка в самом листе
  // ведёт сюда). Номер телефона не отключается — он в листе всегда.
  const contactFields = useEnabledContactFields();

  // Возврат на список с nonce-параметром — index открывает нужный шит.
  const backToList = (param: "openImport" | "openContacts") =>
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
            // Каналы перечисляем, поля — счётчиком: полный список обоих
            // наборов в одну строку не влезает и читается как каша.
            sub={`${offeredChannels()
              .filter((c) => channels.includes(c.id))
              .map((c) => c.label)
              .join(" · ")} · в карточку ${contactFields.length}`}
            onPress={() => router.push("/clients/channels")}
          />

          <Divider inset={56} />
          <Row
            tile="#2F6FD6"
            icon={Navigation}
            title="Карты для маршрута"
            sub={mapServicesSummary(mapServices)}
            onPress={() => router.push("/clients/maps")}
          />
        </SectionCard>

        {/* СПРАВОЧНИКИ — то, из чего собирается карточка: типы объектов
            («Вилла», «Дом»), метки, теги. Владелец 2026-08-02: «всё, что
            можно делать в клиентах, потом редактировать и исправлять».
            Экраны справочников общие с Кабинетом — заводить вторые не
            нужно, нужен вход отсюда, из места, где ими пользуются. */}
        <SectionEyebrow>Справочники</SectionEyebrow>
        <SectionCard>
          <Row
            tile="#0E7C86"
            icon={Home}
            title="Типы объектов"
            sub="Вилла, дом, квартира, офис"
            onPress={() => router.push("/clients/object-types")}
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
          {/* Контакты телефона — первый способ, а не второй: у малого
              сервиса база лежит именно там, а CSV требует сначала где-то
              собрать таблицу, то есть не сделать никогда. В сборке без
              нативного модуля строки нет вовсе. */}
          {CONTACTS_AVAILABLE ? (
            <>
              <Row
                tile="#2F6FD6"
                icon={Smartphone}
                title="Из контактов телефона"
                sub="Выбрать, кого добавить"
                onPress={() => backToList("openContacts")}
              />
              <Divider inset={56} />
            </>
          ) : null}
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

    </Screen>
  );
}
