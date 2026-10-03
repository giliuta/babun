import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useInClientsTab } from "@/features/clients/reference-href";
import { ScrollView, View } from "react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import type { Client } from "@babun/shared/local/clients";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClientObjectsSection } from "@/features/clients/ClientObjectsSection";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { useClientPeople } from "@/features/clients/ClientPeopleDoor";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useCardAccess } from "@/features/clients/use-card-access";
import type { Appointment } from "@babun/shared/local/appointments";

const NO_APPOINTMENTS: Appointment[] = [];

// ВСЕ ОБЪЕКТЫ КЛИЕНТА — СВОЯ СТРАНИЦА (владелец 22.09: «блок объекты —
// нажимаю, и открывается страница, где все объекты… если у клиента 12
// объектов, их надо пролистать, чтобы добраться до файлов»). Тот же путь,
// что у истории записей: на карточке первые строки и дверь, здесь — весь
// список.
//
// Блок собирает ТОТ ЖЕ компонент, что на карточке (`ClientObjectsSection`):
// листы правки и добавления, жильцы, заметки объектов — всё одно и то же.
//
// 03.10: на карточке — один объект, тап по нему — сюда. Здесь тап по объекту
// — лист правки, а «Добавить объект» — кнопкой внизу, как «Записать клиента»
// в истории: на одном уровне с кнопками соседних экранов.

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
  // Права блоков этого клиента (30.09): «Объекты» и «Люди» — видно ли и
  // правится ли, как на карточке.
  const access = useCardAccess(client, false);
  const [adding, setAdding] = useState(false);
  const people = useClientPeople({
    id,
    client: client ?? undefined,
    isDraft: false,
    // Страница открывается только у сохранённого клиента — черновика здесь
    // нет, и связи пишет обычный писатель.
    onDraftLinks: () => {},
    access: access.people,
  });

  // Во вкладке нижний край держит таб-бар; поверх записи — свой.
  const inTab = useInClientsTab();
  return (
    // Нижнюю зону держит таб-бар — кнопка на уровне соседних экранов.
    <Screen edges={inTab ? ["top"] : undefined}>
      <ScreenHeader title="Объекты" subtitle={client?.full_name ?? undefined} />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : !client ? (
        // Клиента нет (удалён, нет связи) — словами, а не вечной загрузкой.
        <EmptyState fill title="Клиент не найден" />
      ) : !access.objects.show ? null : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <ClientObjectsSection
            client={client}
            update={update}
            draft={false}
            readOnly={!access.objects.edit}
            // «был 12 авг» — из записей: без права «История» их нет (аудит
            // 03.10 — на карточке так и было, на странице дата протекала).
            appointments={access.history.show ? appointments : NO_APPOINTMENTS}
            bare
            adding={adding}
            onAddingChange={setAdding}
            {...people.residents}
          />
        </ScrollView>
      )}
      {client && access.objects.show && access.objects.edit ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Добавить объект" onPress={() => setAdding(true)} />
        </View>
      ) : null}
      {people.door}
    </Screen>
  );
}
