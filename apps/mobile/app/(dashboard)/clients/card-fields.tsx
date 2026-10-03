import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import {
  Bookmark,
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

// «БЛОКИ КЛИЕНТОВ» — ВСЁ О ВИДЕ КЛИЕНТА НА ОДНОЙ СТРАНИЦЕ (владелец 03.10:
// «заметка, личная, метка, тег — раздельно, люди и так далее… назвать „блоки
// клиентов“, как в календаре, и полноценно запихнуть всё в одну страницу»).
// Анатомия — как у «Записей» календаря: обязательное одной строкой «Всегда:
// …», выключаемое — строками с галкой.
//
//   • «Карточка клиента» — блоки страницы клиента у всей команды
//     (`team_design.disabled_blocks`); у людей, файлов и реквизитов
//     выключатель компании главнее, объекты гасит и функция компании.
//   • «В списке» — что видно под именем в списке клиентов
//     (`team_design.client_list_off`).
//
// Команда едет адресом из «Настроек клиентов»; без неё — первая команда.

type PageBlock = {
  label: string;
  pinned?: boolean;
  key?: ClientFunctionKey;
  icon?: LucideIcon;
};

// Порядок — порядок страницы клиента.
const PAGE_BLOCKS: PageBlock[] = [
  { label: "Клиент", pinned: true },
  { label: "Заметка", key: "client_note", icon: StickyNote },
  { label: "Люди", key: "client_people", icon: UsersRound },
  { label: "История", pinned: true },
  { label: "Объекты", key: "client_objects", icon: Home },
  { label: "Файлы", key: "client_files", icon: Paperclip },
  { label: "Реквизиты", key: "client_requisites", icon: FileText },
  { label: "Метка", key: "client_labels", icon: Bookmark },
  { label: "Тег", key: "client_tags", icon: Tags },
  { label: "Личное", key: "client_personal", icon: UserRound },
];

// Денег в строке нет (владелец 01.10) — они на странице клиента.
const ROW_FIELDS: { field: CardField; label: string; icon: LucideIcon }[] = [
  { field: "phone", label: "Телефон", icon: Phone },
  { field: "last", label: "Последняя запись", icon: Clock },
];

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientBlocksSettingsRoute() {
  return (
    <ClientSettingsRoute row="card">
      <ClientBlocksSettingsScreen />
    </ClientSettingsRoute>
  );
}

function ClientBlocksSettingsScreen() {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamRow =
    (team ? ownTeams.find((tm) => tm.id === team) : undefined) ?? ownTeams[0] ?? null;
  const teamId = teamRow?.id ?? null;
  // «Только видит» (владелец 01.10) — галки стоят, но не переключаются.
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
    client_tags: useClientFunctionOn("client_tags", teamId),
    client_personal: useClientFunctionOn("client_personal", teamId),
  };
  // Выключено у всей компании — у команды его не включить: строка гаснет.
  const companyPeople = useFeatureOn("client_people");
  const companyFiles = useFeatureOn("client_files");
  const companyRequisites = useFeatureOn("client_requisites");
  const companyLocked = (key: ClientFunctionKey): boolean =>
    (key === "client_people" && !companyPeople) ||
    (key === "client_files" && !companyFiles) ||
    (key === "client_requisites" && !companyRequisites);
  const toggleFunction = useToggleClientFunction(teamId);
  const blocks = PAGE_BLOCKS.filter((b) => objectsOn || b.key !== "client_objects");

  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields(teamId);
  const toggleField = useToggleCardField(teamId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Блоки клиентов" subtitle={teamRow?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard title="Карточка клиента">
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
                  locked={companyLocked(key)}
                  readOnly={readOnly}
                  onToggle={() => toggleFunction.mutate({ key, on: !functionOn[key] })}
                />
              );
            })}
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей команды. Данные остаются." />

        <SectionCard title="В списке">
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
        <RowCaption text="Что видно под именем в списке клиентов." />
      </ScrollView>
    </Screen>
  );
}
