import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, type Href } from "expo-router";
import { RotateCcw, Trash2 } from "lucide-react-native";
import { isOnline } from "@babun/shared/sync";
import { AppearanceTile, appearanceRowFill } from "@/components/ui/AppearanceSheet";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { GUTTER } from "@/components/ui/tokens";
import { confirmThen } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";
import { DaysLeft, DeletedOn } from "@/features/clients/HiddenClientsScreen";
import { deleteAccountAlert } from "@/features/finances/account-alerts";
import { accountIcon } from "@/features/finances/account-ui";
import {
  useDeleteAccount,
  useDeletedAccounts,
  useRestoreAccount,
} from "@/features/finances/accounts";
import type { Account } from "@babun/shared/local/finance/account";

// «УДАЛЁННЫЕ СЧЕТА» — КАК «УДАЛЁННЫЕ КЛИЕНТЫ» (владелец 03.10: «попадают в
// папку „Удалённые счета" на 30 дней, как клиенты»).
//
// Строка — тот же облик счёта, что на странице «Счета»: значок, имя, «удалён
// 3 окт.» под ним и срок справа. Левая кромка — «Вернуть»: счёт снова открыт
// в своей команде. Правая — «Удалить» насовсем, только у счёта без истории:
// его и так сотрёт ночная очистка, когда выйдет срок. Счёт с операциями
// лежит без срока — история денег не стирается. Долгое нажатие открывает те
// же действия словами — как у «Удалённых клиентов»: кто не свайпает, не
// упирается в мёртвый список.
export default function AccountsTrashRoute() {
  const t = useThemeColors();
  const toast = useToast();
  const { team } = useLocalSearchParams<{ team?: string }>();
  const deleted = useDeletedAccounts();
  const restore = useRestoreAccount();
  const erase = useDeleteAccount();
  const rows = (deleted.data ?? []).filter((account) => !team || account.brigade_id === team);
  const [menu, setMenu] = useState<Account | null>(null);

  const giveBack = (account: Account) =>
    restore.mutate(account.id, {
      onSuccess: () => toast(`Счёт «${account.name}» возвращён`),
      onError: (e) =>
        toast(
          isOnline() ? e.message : "Без сети счёт не вернуть — счета живут на сервере.",
          "error",
        ),
    });

  const eraseForever = (account: Account) => {
    const text = deleteAccountAlert(account.name);
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm, destructive: true },
      () =>
        erase.mutateAsync(account.id).then(
          () => toast(`Счёт «${account.name}» удалён насовсем`),
          (e: unknown) =>
            toast(
              isOnline()
                ? `Не удалось удалить счёт: ${e instanceof Error ? e.message : String(e)}`
                : "Без сети счёт не удалить — счета живут на сервере.",
              "error",
            ),
        ),
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Удалённые счета"
        fallbackHref={(team ? `/accounts/settings?team=${encodeURIComponent(team)}` : "/accounts/settings") as Href}
      />
      {deleted.data === undefined ? (
        deleted.error ? (
          <EmptyState
            state="error"
            fill
            title="Не удалось загрузить счета"
            subtitle={deleted.error.message}
            action={{ label: "Повторить", onPress: () => void deleted.refetch() }}
          />
        ) : (
          <EmptyState state="loading" fill title="Загружаем счета" />
        )
      ) : rows.length === 0 ? (
        <EmptyState fill title="Пусто" />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}>
          <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
            {rows.map((account) => (
              <SwipeRow
                key={account.id}
                leading={{
                  label: "Вернуть",
                  color: t.success,
                  icon: RotateCcw,
                  accessibilityLabel: `Вернуть счёт ${account.name}`,
                  onAction: () => giveBack(account),
                }}
                label={account.purge_at ? "Удалить" : undefined}
                color={t.danger}
                icon={account.purge_at ? Trash2 : undefined}
                accessibilityLabel={account.purge_at ? `Удалить счёт ${account.name} насовсем` : undefined}
                onAction={account.purge_at ? () => eraseForever(account) : undefined}
              >
                <Pressable
                  onLongPress={() => setMenu(account)}
                  delayLongPress={350}
                  accessibilityLabel={[account.name, DeletedOn(account.deleted_at)].join(", ")}
                  accessibilityActions={[
                    { name: "restore", label: "Вернуть" },
                    ...(account.purge_at ? [{ name: "erase", label: "Удалить насовсем" }] : []),
                  ]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "restore") giveBack(account);
                    if (event.nativeEvent.actionName === "erase") eraseForever(account);
                  }}
                  style={({ pressed }) => ({
                    height: 52,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    backgroundColor: appearanceRowFill(account.color, pressed, {
                      rest: t.surface,
                      pressed: t.pressed,
                    }),
                  })}
                >
                  <AppearanceTile
                    color={account.color}
                    icon={account.icon}
                    fallback={accountIcon(account)}
                    size={28}
                  />
                  <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 16, color: t.ink }}>
                      {account.name}
                    </Text>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13, color: t.sub }}>
                      {DeletedOn(account.deleted_at)}
                    </Text>
                  </View>
                  <DaysLeft purgeAt={account.purge_at} />
                </Pressable>
              </SwipeRow>
            ))}
          </View>
        </ScrollView>
      )}
      <PickerSheet
        visible={menu !== null}
        title={menu?.name ?? "Счёт"}
        items={
          menu
            ? [
                {
                  id: "restore",
                  label: "Вернуть",
                  icon: RotateCcw,
                  color: t.success,
                  onPress: () => {
                    const account = menu;
                    setMenu(null);
                    giveBack(account);
                  },
                },
                ...(menu.purge_at
                  ? [
                      {
                        id: "erase",
                        label: "Удалить насовсем",
                        icon: Trash2,
                        color: t.danger,
                        onPress: () => {
                          const account = menu;
                          setMenu(null);
                          // Вопрос — после отъезда меню: поверх уезжающего
                          // листа iOS окно не покажет.
                          setTimeout(() => eraseForever(account), SHEET_EXIT_MS + 350);
                        },
                      },
                    ]
                  : []),
              ]
            : []
        }
        onClose={() => setMenu(null)}
      />
    </Screen>
  );
}
