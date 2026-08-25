import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatCountRu, FORMS_SCHET } from "@babun/shared/common/utils/plural-ru";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { NavRow, RowGroup } from "@/components/ui/card-rows";
import { AccountCreateSheet } from "@/features/finances/AccountCreateSheet";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { useIsOnline } from "@babun/shared/sync";

// НАСТРОЙКИ СЧЕТОВ — РЕДКОЕ, УБРАННОЕ С РАБОЧЕГО ЭКРАНА (ТЗ §5.1, §13/С7).
//
// Счёт заводят раз в квартал, а остаток смотрят двадцать раз в день, поэтому
// нижняя полоса экрана счетов — место под большим пальцем — квартальному
// действию не отдаётся. Здесь живёт всё, что делают редко: завести счёт,
// поправить порядок строк, открыть закрытый.
//
// Страница, а не лист: это НАБОР настроек (закон продукта 2026-08-02). Лист
// остаётся ровно один и ровно на действие — «Новый счёт».

export default function AccountsSettingsScreen() {
  const router = useRouter();
  const online = useIsOnline();
  // `?create=1` — «Добавить счёт» с пустой панели «Финансов»: кнопка обязана
  // делать то, что называет, а не вести к ещё одной такой же кнопке. Только
  // НАЧАЛЬНОЕ значение: параметр живёт в URL дольше, чем нужен, и не должен
  // пере-открывать закрытый лист.
  const { create } = useLocalSearchParams<{ create?: string }>();
  const [createOpen, setCreateOpen] = useState(create === "1");

  // Полный список: закрытые нужны и для счётчика архива, и для проверки
  // дубля имени в листе создания.
  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const teamsQuery = useTeams();

  const all = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const closedCount = all.filter((account) => !account.is_active).length;

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending (§8): без сети запрос стоит
  // в paused и остаётся pending навсегда — экран крутил бы спиннер вечно.
  const hasData =
    accountsQuery.data !== undefined && teamsQuery.data !== undefined;
  const loadError = hasData
    ? null
    : (accountsQuery.error ?? teamsQuery.error ?? null);
  const retry = () => {
    void accountsQuery.refetch();
    void teamsQuery.refetch();
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Настройки счетов" />
      {!hasData && !loadError ? (
        online ? (
          <EmptyState state="loading" fill title="Загружаем счета" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счета ещё не загружены на это устройство"
            action={{ label: "Повторить", onPress: retry }}
          />
        )
      ) : loadError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <RowGroup footer="Счёт — это касса, карта или банковский счёт, где лежат деньги.">
            <AddRow label="Добавить счёт" onPress={() => setCreateOpen(true)} />
            <NavRow
              label="Порядок счетов"
              separated
              onPress={() => router.push("/accounts/order")}
            />
            <NavRow
              label="Закрытые счета"
              // Ноль печатаем словом: «0» рядом с деньгами читается как сумма.
              value={
                closedCount > 0 ? formatCountRu(closedCount, FORMS_SCHET) : "нет"
              }
              separated
              onPress={() => router.push("/accounts/archive")}
            />
          </RowGroup>
        </ScrollView>
      )}

      {/* Кому заводится счёт, лист спрашивает сам: сюда приходят без
          выбранной команды, а у тенанта с одной командой вопроса нет вовсе. */}
      <AccountCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        teams={teams}
        accounts={all}
      />
    </Screen>
  );
}
