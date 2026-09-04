import { useMemo } from "react";
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  Archive,
  Download,
  Eye,
  Home,
  MessageCircle,
  Navigation,
  Tags,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react-native";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { Screen } from "@/components/ui/Screen";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { CONTACTS_AVAILABLE } from "@/features/clients/import/ContactsImportSheet";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { useToast } from "@/components/ui/Toast";
import {
  cardFieldsSummary,
  DEFAULT_CARD_FIELDS,
  useCardFields,
} from "@/features/clients/card-prefs";
import {
  contactWayDef,
  useEnabledWays,
} from "@/features/clients/contact-ways";
import {
  mapServicesSummary,
  useEnabledMapServices,
} from "@/lib/map-services";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useClients, useClientTags } from "@/features/clients/queries";
import { useAppointments } from "@/features/calendar/queries";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";

// v811 — «Настройки клиентов». Открывается шестерёнкой из хедера списка
// (порт web ClientsSettingsScreen). Группы:
//   • Отображение — Что показывать (live card-fields) · Теги клиентов.
//     Сортировка ЗДЕСЬ НЕ живёт: она первая строка листа «Фильтры»
//     (решение владельца 2026-07-25), персист в sort-pref.ts.
//   • Данные — Импорт CSV (мастер ImportWizardSheet: выбор файла →
//     маппинг колонок → превью+валидация → импорт с прогрессом/резюмом).
//     Экспорт CSV выполняется через системный share sheet.

export default function ClientsSettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields();
  const clientsQuery = useClients();
  const tagsQuery = useClientTags();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  // Долг для выгрузки считается тем же селектором, что везде.
  const { data: appointmentsForStats = [] } = useAppointments();
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointmentsForStats),
    [clients, appointmentsForStats],
  );
  const tags = tagsQuery.data ?? [];
  // Карты для маршрута: у кого-то весь навигатор — Google, и Яндекс в листе
  // только удлиняет каждый выезд (владелец 2026-08-02).
  const mapServices = useEnabledMapServices();
  // Чем вообще связываются с клиентом — один набор на кнопку у номера и на
  // плюс в карточке.
  const enabledWays = useEnabledWays();

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
      const shared = await shareClientsCsv(exportClients, exportTags, statsMap);
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
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Eye}
            title="Что показывать на карточке"
            sub={cardFieldsSummary(prefs)}
            onPress={() => router.push("/clients/card-fields")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.green}
            icon={MessageCircle}
            title="Способы связи"
            // НАБОР ОДИН, И ПОДПИСЬ ОДНА (владелец 2026-09-04: «зачем „можно
            // добавить в карточку“ или „у номера“ — немного странно»). Раньше
            // строка складывала два списка — перечисление каналов и счётчик
            // полей — и читалась как каша из двух настроек.
            sub={enabledWays
              .map((id) => contactWayDef(id)?.label)
              .filter(Boolean)
              .join(" · ")}
            onPress={() => router.push("/clients/channels")}
          />

          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.blue}
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
          <SettingsRow
            tile={SETTINGS_TILE.teal}
            icon={Home}
            title="Типы объектов"
            sub="Вилла, дом, квартира, офис"
            onPress={() => router.push("/clients/object-types")}
          />

          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.purple}
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
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Smartphone}
                title="Из контактов телефона"
                sub="Выбрать, кого добавить"
                onPress={() => backToList("openContacts")}
              />
              <Divider inset={56} />
            </>
          ) : null}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Upload}
            title="Импорт из CSV"
            sub="Загрузить клиентов из файла"
            onPress={() => backToList("openImport")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.green}
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
          <SettingsRow
            tile="neutral"
            icon={Archive}
            title="Архив клиентов"
            sub="Убраны из работы, история цела"
            onPress={() => router.push("/clients/archive")}
          />
          <Divider inset={56} />
          {/* Две полки рядом и подписаны по-разному: архив — без срока,
              корзина — со счётчиком. Иначе «куда он делся» повторится, уже
              с двумя одинаковыми на вид дверями. */}
          <SettingsRow
            tile={SETTINGS_TILE.red}
            icon={Trash2}
            title="Недавно удалённые"
            sub={`Хранятся ${TRASH_DAYS} дней, потом стираются`}
            onPress={() => router.push("/clients/trash")}
          />
        </SectionCard>
      </ScrollView>

    </Screen>
  );
}
