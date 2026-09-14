import { ScrollView } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";

import { InvitationCards } from "./InvitationCards";
import { useMyInvitations } from "./inbox-queries";

// СТРАНИЦА «ПРИГЛАШЕНИЯ» В КАБИНЕТЕ (STORY-081). Дверь к ней — строка
// `InvitationsRow` на постоянном месте: блок, видный только при приглашениях,
// владелец не нашёл. Здесь приглашения из всех компаний, новые сверху, с
// «Принять / Отклонить»; пусто — говорим, что пусто, а не рисуем ничего.
export function InvitationsScreen() {
  const query = useMyInvitations();
  const invitations = query.data ?? [];

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Приглашения" />
      {query.isLoading ? (
        <EmptyState state="loading" fill />
      ) : query.isError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить приглашения"
          action={{ label: "Повторить", onPress: () => void query.refetch() }}
        />
      ) : invitations.length === 0 ? (
        <EmptyState
          fill
          title="Приглашений нет"
          subtitle="Когда вас пригласят в команду, приглашение появится здесь."
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <InvitationCards invitations={invitations} />
        </ScrollView>
      )}
    </Screen>
  );
}
