import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { Clock, Phone, type LucideIcon } from "lucide-react-native";
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
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { useClientSettingLevel } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";

// «СТРОКА В СПИСКЕ» — ЧТО ВИДНО ПОД ИМЕНЕМ В СПИСКЕ КЛИЕНТОВ (владелец 02.10:
// «настройки клиентов — по функциям»). До 02.10 здесь же жили блоки
// страницы клиента («Карточка клиента»); теперь каждый блок — своя строка
// шестерёнки («Заметка», «Объекты», «Метка и тег»…), а эта страница — только
// про строку списка. У всей команды (`team_design.client_list_off`).
//
// Команда едет адресом из «Настроек клиентов»; без неё — первая команда.

// Денег в строке нет (владелец 01.10) — они на странице клиента.
const ROW_FIELDS: { field: CardField; label: string; icon: LucideIcon }[] = [
  { field: "phone", label: "Телефон", icon: Phone },
  { field: "last", label: "Последняя запись", icon: Clock },
];

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientListRowSettingsRoute() {
  return (
    <ClientSettingsRoute row="card">
      <ClientListRowSettingsScreen />
    </ClientSettingsRoute>
  );
}

function ClientListRowSettingsScreen() {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamRow =
    (team ? ownTeams.find((tm) => tm.id === team) : undefined) ?? ownTeams[0] ?? null;
  const teamId = teamRow?.id ?? null;
  // «Только видит» (владелец 01.10) — галки стоят, но не переключаются.
  const readOnly = useClientSettingLevel("card", teamId) !== "write";
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields(teamId);
  const toggleField = useToggleCardField(teamId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Строка в списке" subtitle={teamRow?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard title="Под именем">
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
