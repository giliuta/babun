import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import {
  Clock,
  FileText,
  Home,
  Paperclip,
  Phone,
  StickyNote,
  Tags,
  UserRound,
  UsersRound,
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
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { useClientSettingLevel } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";
import { useFeatureOn } from "@/features/settings/company-features";

// «КАРТОЧКА КЛИЕНТА» — ИЗ ЧЕГО СОБРАН КЛИЕНТ У КОМАНДЫ (владелец 30.09:
// «название „что показывать на карточке“ неправильно — сделай то же самое,
// как это выглядит у нас в записи клиентов в календаре»). Та же анатомия, что
// у «Записей»: обязательное — одной строкой «Всегда: …», выключаемое — строки
// с галкой.
//
//   • «Блоки страницы» — блоки страницы клиента; «Всегда» только клиент и
//     история. Выключается у всей команды (`team_design`); у людей, файлов и
//     реквизитов выключатель компании (STORY-088) главнее.
//   • «Строка в списке» — что видно под именем в списке клиентов; тоже у
//     всей команды (`team_design.client_list_off`, 30.09).
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
  { label: "Заметка", key: "client_note", icon: StickyNote },
  { label: "История", pinned: true },
  { label: "Люди", key: "client_people", icon: UsersRound },
  { label: "Объекты", key: "client_objects", icon: Home },
  { label: "Файлы", key: "client_files", icon: Paperclip },
  { label: "Реквизиты", key: "client_requisites", icon: FileText },
  { label: "Метка и тег", key: "client_labels", icon: Tags },
  { label: "Личное", key: "client_personal", icon: UserRound },
];

// Денег в строке нет (владелец 01.10) — они на странице клиента.
const ROW_FIELDS: { field: CardField; label: string; icon: LucideIcon }[] = [
  { field: "phone", label: "Телефон", icon: Phone },
  { field: "last", label: "Последняя запись", icon: Clock },
];

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientCardSettingsRoute() {
  return (
    <ClientSettingsRoute row="card">
      <ClientCardSettingsScreen />
    </ClientSettingsRoute>
  );
}

function ClientCardSettingsScreen() {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamRow =
    (team ? ownTeams.find((tm) => tm.id === team) : undefined) ?? ownTeams[0] ?? null;
  const teamId = teamRow?.id ?? null;
  // «Только видит» (владелец 01.10) — галки стоят, но не переключаются; и
  // блоки страницы, и строка списка — одно право «Карточки клиента».
  const readOnly = useClientSettingLevel("card", teamId) !== "write";

  // Объекты выключаются у компании там, где их заводят («Записи»): без них
  // блока нет вовсе — ни галкой, ни во «Всегда».
  const objectsOn = useFeatureOn("objects");
  const functionOn: Record<ClientFunctionKey, boolean> = {
    client_note: useClientFunctionOn("client_note", teamId),
    client_people: useClientFunctionOn("client_people", teamId),
    client_objects: useClientFunctionOn("client_objects", teamId),
    client_files: useClientFunctionOn("client_files", teamId),
    client_requisites: useClientFunctionOn("client_requisites", teamId),
    client_labels: useClientFunctionOn("client_labels", teamId),
    client_personal: useClientFunctionOn("client_personal", teamId),
  };
  // Выключено у всей компании — у команды его не включить: строка гаснет.
  const companyPeople = useFeatureOn("client_people");
  const companyFiles = useFeatureOn("client_files");
  const companyRequisites = useFeatureOn("client_requisites");
  const companyOn: Record<ClientFunctionKey, boolean> = {
    client_note: true,
    client_people: companyPeople,
    client_objects: true,
    client_files: companyFiles,
    client_requisites: companyRequisites,
    client_labels: true,
    client_personal: true,
  };
  const toggleFunction = useToggleClientFunction(teamId);

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
              readOnly={readOnly}
              onToggle={() => toggleField.mutate(f.field)}
            />
          ))}
        </SectionCard>
        <RowCaption text="Выключенное поле пропадает из строки у всей команды." />
      </ScrollView>
    </Screen>
  );
}
