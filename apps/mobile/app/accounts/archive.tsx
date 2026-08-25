import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { RowGroup } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { accountIcon } from "@/features/finances/account-ui";
import {
  useAccountsWithBalances,
  useReopenAccount,
  useSoftCloseAccount,
  type AccountWithBalance,
} from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { useThemeColors } from "@/theme/colors";

// ЗАКРЫТЫЕ СЧЕТА — СВОЙ МАРШРУТ, А НЕ ВЕТКА СПИСКА (ТЗ §5.6, §13/С7).
//
// Раньше архив жил параметром `/accounts?archived=1`: тот же экран рисовал сам
// себя поверх себя, второй раз тянул все запросы счетов и держал в голове
// ветку «а это архив» в каждом состоянии. Теперь это отдельная страница за
// «Настройки счетов».
//
// ЦИФРЫ ЗДЕСЬ НЕТ — ЕСТЬ СОСТОЯНИЕ. У закрытого счёта печатается «Закрыт», а
// не «€0»: ноль в денежной колонке читается как правда о деньгах («на счету
// пусто»), хотя означает совсем другое — счёт не участвует в подсчётах вовсе.
// Исключение ровно одно: если на закрытом счёте остались деньги, сумма
// печатается янтарём. Такой счёт закрыли, не сдав остаток, и эти деньги не
// видно больше нигде в продукте — единственное место, где о них можно
// сказать, это здесь.

export default function AccountsArchiveScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  // Включая архивные команды: счёт живёт дольше своей команды, и подпись
  // «Команда удалена» честнее пустоты.
  const teamsQuery = useTeams({ includeInactive: true });

  const closed = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => !account.is_active),
    [accountsQuery.data],
  );
  const teamById = useMemo(
    () => new Map((teamsQuery.data ?? []).map((team) => [team.id, team])),
    [teamsQuery.data],
  );

  const reopen = useReopenAccount();
  const close = useSoftCloseAccount();

  // ОТКРЫТИЕ ОБРАТИМО — значит тостом с «Отменить», а не вопросом до
  // действия (тот же приём, что у перевода и архива клиентов). Вопрос перед
  // нажатием читают как формальность; кнопка рядом с уже случившимся — нет.
  const openAgain = (account: AccountWithBalance, left: boolean) => {
    reopen.mutate(account.id, {
      // ОТМЕНА ПРЕДЛАГАЕТСЯ ТОЛЬКО ТАМ, ГДЕ ОНА СРАБОТАЕТ. Счёт с остатком
      // закрыть нельзя (`guard_account_financial_history`) — у янтарной строки
      // кнопка «Отменить» отбивалась бы ВСЕГДА. Такой счёт закрывают из его
      // настроек: там есть единственная рабочая дорога — сдать остаток.
      onSuccess: () =>
        toast(
          `Счёт «${account.name}» открыт`,
          "success",
          left
            ? undefined
            : {
                label: "Отменить",
                onPress: () =>
                  close.mutate(account.id, {
                    onError: (e) =>
                      toast(`Не удалось закрыть счёт: ${e.message}`, "error"),
                  }),
              },
        ),
      // Кромку свайпа погасить нельзя — у неё нет подписи, которую читают до
      // жеста. Значит причина обязана приехать словами В ОТВЕТ: сырое
      // «Network request failed» не отвечает на единственный вопрос —
      // открылся счёт или нет.
      onError: (e) =>
        toast(
          isOnline()
            ? `Не удалось открыть счёт: ${e.message}`
            : "Без сети счёт не открыть — счета живут на сервере.",
          "error",
        ),
    });
  };

  // ЧЕЙ БЫЛ СЧЁТ. У счёта один владелец — команда (владелец 2026-08-15).
  // Счёт без неё остался от старой схемы «общего счёта»: молчать о нём нельзя,
  // деньги на нём настоящие.
  const subtitle = (account: AccountWithBalance): string =>
    account.brigade_id
      ? (teamById.get(account.brigade_id)?.name ?? "Команда удалена")
      : "Без команды";

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
      <ScreenHeader title="Закрытые счета" />
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
      ) : closed.length === 0 ? (
        <EmptyState
          fill
          title="Нет закрытых счетов"
          subtitle="Закрытый счёт сохраняет свою историю и может быть открыт снова"
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <RowGroup footer="Закрытый счёт не входит ни в один итог и не предлагается при приёме денег. История операций у него сохраняется.">
            {closed.map((account, index) => {
              const left = moneySign(account.balance) !== 0;
              return (
                <View key={account.id}>
                  {index > 0 ? <Divider inset={48} /> : null}
                  <SwipeRow
                    label="Открыть"
                    color={t.accent}
                    icon={RotateCcw}
                    accessibilityLabel={`Открыть счёт ${account.name} снова`}
                    onAction={() => openAgain(account, left)}
                  >
                    <SettingsRow
                      // Выбранные значок и цвет — те же, что в живом списке:
                      // закрытый счёт узнают тем же пальцем.
                      icon={accountIcon(account)}
                      tile={account.color ?? "neutral"}
                      title={account.name}
                      sub={subtitle(account)}
                      value={left ? money(account.balance) : "Закрыт"}
                      valueColor={left ? t.warning : t.faint}
                      a11yLabel={[
                        account.name,
                        subtitle(account),
                        left
                          ? `закрыт с остатком ${money(account.balance)}`
                          : "закрыт",
                      ].join(", ")}
                      // Свайпа для VoiceOver не существует — то же действие
                      // отдаём ротором, теми же словами.
                      a11yActions={[{ name: "reopen", label: "Открыть снова" }]}
                      onA11yAction={(name) => {
                        if (name === "reopen") openAgain(account, left);
                      }}
                      onPress={() => router.push(`/accounts/${account.id}`)}
                    />
                  </SwipeRow>
                </View>
              );
            })}
          </RowGroup>
        </ScrollView>
      )}
    </Screen>
  );
}
