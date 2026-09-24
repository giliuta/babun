import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { UserPlus } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useClient } from "@/features/clients/queries";
import { useClientPeople } from "@/features/clients/ClientPeopleDoor";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";

// ВСЕ ЛЮДИ КАРТОЧКИ — СВОЯ СТРАНИЦА (владелец 22.09: «то же самое можно
// сделать с людьми — как история: нажимаю и открывается страница»). На
// карточке видны первые трое и дверь «Все люди · N», здесь — весь перечень.
//
// Строки собирает ТОТ ЖЕ `useClientPeople`, что карточка: роли, свайп
// «Убрать» и шторка «Кто это» — один код на два места.

export default function ClientPeopleScreenRoute() {
  return (
    // ПРАВА — КАК У САМОЙ КАРТОЧКИ, а не как у визитов и вложений (аудит
    // 23.09): это продолжение её блока, и сотрудник, которому карточка
    // открыта, видит здесь то же самое; правку гасят права блока.
    <ClientsCompanyRoute kind="card">
      <ClientPeopleScreen />
    </ClientsCompanyRoute>
  );
}

function ClientPeopleScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client, isLoading } = useClient(id);
  const people = useClientPeople({
    id,
    client: client ?? undefined,
    isDraft: false,
    // Черновика здесь нет: страница открывается только у сохранённого.
    onDraftLinks: () => {},
  });

  return (
    <Screen>
      <ScreenHeader title="Люди" subtitle={client?.full_name ?? undefined} />
      {isLoading || !client ? (
        <EmptyState state="loading" fill />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <SectionCard>
            {people.peopleRows}
            {people.onAddPerson ? (
              <ChooseRow
                compact
                icon={UserPlus}
                label="Добавить человека"
                onPress={people.onAddPerson}
              />
            ) : null}
          </SectionCard>
        </ScrollView>
      )}
      {people.door}
    </Screen>
  );
}
