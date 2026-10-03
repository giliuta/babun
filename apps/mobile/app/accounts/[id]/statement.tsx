import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { GUTTER } from "@/components/ui/tokens";
import { notify } from "@/lib/notify";
import { accountEditHref } from "@/features/finances/account-editor/editor-logic";
import { StatementPaper } from "@/features/finances/statement/StatementPaper";
import { shareStatementPdf } from "@/features/finances/statement/statement-pdf";
import { useStatementDocument } from "@/features/finances/statement/use-statement";

// ВЫПИСКА СЧЁТА — СНАЧАЛА ЛИСТ, ПОТОМ ФАЙЛ (владелец 03.10: «когда выписка
// делается, то сначала создаётся превью файла, а потом уже можно только
// передавать это»). Открывается строкой «Выписка» в листе счёта; «назад»
// возвращает в тот же лист. На экране — та же бумага, что уйдёт PDF-файлом;
// действие страницы одно — «Поделиться» в футере.
export default function AccountStatementRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const statement = useStatementDocument(id);
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (!statement.doc || sharing) return;
    setSharing(true);
    try {
      await shareStatementPdf(statement.doc);
    } catch (e) {
      notify("Не удалось поделиться выпиской", e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Выписка" fallbackHref={id ? accountEditHref(id) : undefined} />
      {statement.doc ? (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: GUTTER, paddingBottom: 24 }}>
          <StatementPaper doc={statement.doc} />
        </ScrollView>
      ) : statement.error ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось собрать выписку"
          subtitle={statement.error instanceof Error ? statement.error.message : undefined}
          action={{ label: "Повторить", onPress: statement.refetch }}
        />
      ) : statement.loading ? (
        <EmptyState state="loading" fill title="Собираем выписку" />
      ) : (
        <EmptyState fill title="Счёт не найден" />
      )}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="Поделиться PDF"
          loading={sharing}
          disabled={!statement.doc}
          onPress={() => void share()}
        />
      </View>
    </Screen>
  );
}
