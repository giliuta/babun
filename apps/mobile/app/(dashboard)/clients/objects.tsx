import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClientObjectsSection } from "@/features/clients/ClientObjectsSection";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { useClientPeople } from "@/features/clients/ClientPeopleDoor";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";

// ВСЕ ОБЪЕКТЫ КЛИЕНТА — СВОЯ СТРАНИЦА (владелец 22.09: «блок объекты —
// нажимаю, и открывается страница, где все объекты… если у клиента 12
// объектов, их надо пролистать, чтобы добраться до файлов»). Тот же путь,
// что у истории записей: на карточке первые строки и дверь, здесь — весь
// список.
//
// Блок собирает ТОТ ЖЕ компонент, что на карточке (`ClientObjectsSection`):
// листы правки и добавления, жильцы, заметки объектов — всё одно и то же.

export default function ClientObjectsScreenRoute() {
  return (
    // ПРАВА — КАК У САМОЙ КАРТОЧКИ, а не как у визитов и вложений (аудит
    // 23.09): это продолжение её блока, и сотрудник, которому карточка
    // открыта, видит здесь то же самое; правку гасят права блока.
    <ClientsCompanyRoute kind="card">
      <ClientObjectsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientObjectsScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client, isLoading } = useClient(id);
  const { data: appointments = [] } = useClientAppointments(id);
  const updateClient = useUpdateClient(id);
  const update = async (patch: Partial<Client>) => {
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  };
  // Жильцы объектов — та же проводка, что на карточке: строки, роли и дверь
  // заведения живут в одном месте (`ClientPeopleDoor`).
  const people = useClientPeople({
    id,
    client: client ?? undefined,
    isDraft: false,
    // Страница открывается только у сохранённого клиента — черновика здесь
    // нет, и связи пишет обычный писатель.
    onDraftLinks: () => {},
  });

  return (
    <Screen>
      <ScreenHeader title="Объекты" subtitle={client?.full_name ?? undefined} />
      {isLoading || !client ? (
        <EmptyState state="loading" fill />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <ClientObjectsSection
            client={client}
            update={update}
            draft={false}
            appointments={appointments}
            bare
            {...people.residents}
          />
        </ScrollView>
      )}
      {people.door}
    </Screen>
  );
}
