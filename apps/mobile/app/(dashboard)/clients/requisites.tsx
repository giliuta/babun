import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { RequisitesBlock } from "@/features/clients/blocks/RequisitesBlock";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";

// ВСЕ РЕКВИЗИТЫ КЛИЕНТА — СВОЯ СТРАНИЦА (владелец 22.09: «то же самое можно
// сделать с реквизитами — если их будет много»). На карточке видны основной
// и второй набор плюс дверь «Все реквизиты · N», здесь — весь список.
//
// Блок тот же, что на карточке: листы правки, свайп «Удалить» и выбор
// основного живут в одном месте.

export default function ClientRequisitesScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card-sub">
      <ClientRequisitesScreen />
    </ClientsCompanyRoute>
  );
}

function ClientRequisitesScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client, isLoading } = useClient(id);
  const updateClient = useUpdateClient(id);
  const update = async (patch: Partial<Client>) => {
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Реквизиты" subtitle={client?.full_name ?? undefined} />
      {isLoading || !client ? (
        <EmptyState state="loading" fill />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <RequisitesBlock client={client} draft={false} update={update} bare />
        </ScrollView>
      )}
    </Screen>
  );
}
