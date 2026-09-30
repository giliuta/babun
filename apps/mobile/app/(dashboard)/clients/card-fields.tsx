import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import {
  AlertCircle,
  Clock,
  FileText,
  Paperclip,
  Phone,
  Tags,
  TrendingUp,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { RowCaption } from "@/components/ui/card-rows";
import { AlwaysLine, BlockCell } from "@/components/ui/block-toggles";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
  useToggleCardField,
  type CardField,
} from "@/features/clients/card-prefs";
import {
  useClientFunctionOn,
  useToggleClientFunction,
  type ClientFunctionKey,
} from "@/features/clients/client-functions";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useTeams } from "@/features/reference/queries";
import { useFeatureOn } from "@/features/settings/company-features";

// «КАРТОЧКА КЛИЕНТА» — ИЗ ЧЕГО СОБРАН КЛИЕНТ У КОМАНДЫ (владелец 30.09:
// «название „что показывать на карточке“ неправильно — сделай то же самое,
// как это выглядит у нас в записи клиентов в календаре»). Та же анатомия, что
// у «Записей»: обязательное — одной строкой «Всегда: …», выключаемое — строки
// с галкой.
//
//   • «Блоки страницы» — блоки страницы клиента. Люди, файлы и реквизиты
//     выключаются у всей команды (`team_design`); выключатель компании
//     (STORY-088) главнее.
//   • «Строка в списке» — что видно под именем в списке клиентов. Набор
//     команды; пока хранится на телефоне (`card-prefs`).
//
// Команда едет адресом из «Настроек клиентов»; без неё — первая команда.

type PageBlock = {
  label: string;
  pinned?: boolean;
  key?: ClientFunctionKey;
  icon?: LucideIcon;
};

// Порядок — порядок страницы клиента (docs/BLOCKS.md §9.1).
const PAGE_BLOCKS: PageBlock[] = [
  { label: "Клиент", pinned: true },
  { label: "Заметка", pinned: true },
  { label: "История", pinned: true },
  { label: "Люди", key: "client_people", icon: UsersRound },
  { label: "Объекты", pinned: true },
  { label: "Файлы", key: "client_files", icon: Paperclip },
  { label: "Реквизиты", key: "client_requisites", icon: FileText },
  { label: "Метка и тег", pinned: true },
  { label: "Личное", pinned: true },
];

// ВЫРУЧКА, А НЕ ПРИБЫЛЬ: «Ожидается» — сумма будущих записей до расходов.
const ROW_FIELDS: { field: CardField; label: string; icon: LucideIcon }[] = [
  { field: "phone", label: "Телефон", icon: Phone },
  { field: "exp", label: "Ожидается", icon: TrendingUp },
  { field: "inc", label: "Доход", icon: Wallet },
  { field: "debt", label: "Долг", icon: AlertCircle },
  { field: "last", label: "Последняя запись", icon: Clock },
  { field: "meta", label: "Команда, метка, теги", icon: Tags },
];

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientCardSettingsRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientCardSettingsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientCardSettingsScreen() {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamRow =
    (team ? ownTeams.find((tm) => tm.id === team) : undefined) ?? ownTeams[0] ?? null;
  const teamId = teamRow?.id ?? null;
  const caps = useClientsCapabilities();
  const readOnly = !caps.manage;

  // Объекты выключаются у компании там, где их заводят («Записи»): без них
  // блока нет вовсе — ни галкой, ни во «Всегда».
  const objectsOn = useFeatureOn("objects");
  const peopleOn = useClientFunctionOn("client_people", teamId);
  const filesOn = useClientFunctionOn("client_files", teamId);
  const requisitesOn = useClientFunctionOn("client_requisites", teamId);
  const companyPeople = useFeatureOn("client_people");
  const companyFiles = useFeatureOn("client_files");
  const companyRequisites = useFeatureOn("client_requisites");
  const toggleFunction = useToggleClientFunction(teamId);

  const functionOn: Record<ClientFunctionKey, boolean> = {
    client_people: peopleOn,
    client_files: filesOn,
    client_requisites: requisitesOn,
  };
  // Выключено у всей компании — у команды его не включить: строка гаснет.
  const companyOn: Record<ClientFunctionKey, boolean> = {
    client_people: companyPeople,
    client_files: companyFiles,
    client_requisites: companyRequisites,
  };

  const blocks = PAGE_BLOCKS.filter((b) => objectsOn || b.label !== "Объекты");

  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields(teamId);
  const toggleField = useToggleCardField(teamId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Карточка клиента" subtitle={teamRow?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard title="Блоки страницы">
          <AlwaysLine blocks={blocks} />
          {blocks
            .filter((b) => !b.pinned && b.key)
            .map((b) => {
              const key = b.key as ClientFunctionKey;
              return (
                <BlockCell
                  key={key}
                  label={b.label}
                  icon={b.icon ?? FileText}
                  on={functionOn[key]}
                  locked={!companyOn[key]}
                  readOnly={readOnly}
                  onToggle={() => toggleFunction.mutate({ key, on: !functionOn[key] })}
                />
              );
            })}
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей команды. Данные остаются." />

        <SectionCard title="Строка в списке">
          <AlwaysLine blocks={[{ label: "Имя", pinned: true }]} />
          {ROW_FIELDS.map((f) => (
            <BlockCell
              key={f.field}
              label={f.label}
              icon={f.icon}
              on={prefs[f.field]}
              locked={false}
              readOnly={false}
              onToggle={() => toggleField.mutate(f.field)}
            />
          ))}
        </SectionCard>
        <RowCaption text="Строка списка пока настраивается на этом телефоне." />
      </ScrollView>
    </Screen>
  );
}
