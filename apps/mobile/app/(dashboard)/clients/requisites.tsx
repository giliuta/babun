import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useInClientsTab } from "@/features/clients/reference-href";
import { ScrollView, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { clientRequisitesOf } from "@babun/shared/local/client-requisites";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { RequisitesBlock } from "@/features/clients/blocks/RequisitesBlock";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useCardAccess } from "@/features/clients/use-card-access";
import { haptics } from "@/lib/haptics";

// ВСЕ РЕКВИЗИТЫ КЛИЕНТА — СВОЯ СТРАНИЦА, КАК «ИСТОРИЯ» И «ФАЙЛЫ» (владелец
// 03.10). На карточке — основной набор одной плашкой, тап ведёт сюда; здесь
// каждый набор своей плашкой. Блок тот же, что на карточке: листы правки,
// свайп «Удалить» и выбор основного живут в одном месте. «Добавить
// реквизиты» — внизу, на месте главного действия, как «Добавить объект».
//
// С 30.09 страница открыта и сотруднику — по праву «Реквизиты» этого
// клиента (`card-access.ts`): «Видит» — только читать, «Скрыт» — пусто.

export default function ClientRequisitesScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientRequisitesScreen />
    </ClientsCompanyRoute>
  );
}

function ClientRequisitesScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client, isLoading } = useClient(id);
  const updateClient = useUpdateClient(id);
  const access = useCardAccess(client, false);
  const [adding, setAdding] = useState(false);
  const update = async (patch: Partial<Client>) => {
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  };
  const empty = client ? clientRequisitesOf(client).length === 0 : false;
  const canEdit = access.requisites.edit;

  // Во вкладке нижний край держит таб-бар; поверх записи — свой.
  const inTab = useInClientsTab();
  return (
    // Нижнюю зону держит таб-бар — кнопка внизу на той же высоте, что у
    // «Истории», «Файлов» и «Объектов».
    <Screen edges={inTab ? ["top"] : undefined}>
      <ScreenHeader title="Реквизиты" subtitle={client?.full_name ?? undefined} />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : !client ? (
        <EmptyState fill title="Клиент не найден" />
      ) : !access.requisites.show ? null : (
        <>
          {/* ПУСТО — ОДНИМ СЛОВОМ (закон 15.09): «Добавить» — внизу. Блок
              стоит и здесь: лист нового набора живёт в нём. */}
          {empty ? <EmptyState fill title="Реквизитов нет" /> : null}
          <ScrollView
            style={empty ? { flexGrow: 0 } : undefined}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
          >
            <RequisitesBlock
              client={client}
              draft={false}
              update={update}
              bare
              readOnly={!canEdit}
              adding={adding}
              onAddingChange={setAdding}
            />
          </ScrollView>
        </>
      )}
      {client && access.requisites.show && canEdit ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="Добавить реквизиты"
            onPress={() => {
              haptics.tap();
              setAdding(true);
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
