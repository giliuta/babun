import { useMemo, type ReactElement } from "react";
import { ScrollView, View, type RefreshControlProps } from "react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { RowGroupBody } from "@/components/ui/card-rows";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "./accounts";
import { accountIcon } from "./account-ui";
import { sortAccountRows } from "./accounts-sections";
import { PanelHeader } from "./PanelHeader";

// СЧЕТА РАСКРЫВАЮТСЯ ЗДЕСЬ, А НЕ УВОДЯТ (владелец 2026-08-11: «перекинем
// вниз, в операции»). Ответ «где лежат деньги» — такой же срез команды, как
// доход и долги, и уходить за ним на другой экран незачем.
//
// ВЫГЛЯДИТ ТОЧНО КАК СТРАНИЦА СЧЕТОВ: каждый счёт — отдельная карточка с
// зазором, та же строка (`SettingsRow`), та же подпись (`accountRowCaption`),
// тот же порядок (`sortAccountRows`). Панель и страница, собранные по-разному,
// читались бы как два разных продукта.
//
// Страница остаётся последней строкой: там живут создание, перевод, сверка,
// порядок и закрытые счета — то, чем УПРАВЛЯЮТ.
export function AccountsPanel({
  accounts,
  teams,
  onOpen,
  refreshControl,
}: {
  /** Ровно тот набор, который просуммирован плиткой «Счета»: список и цифра
   *  над ним обязаны сходиться пальцем. */
  accounts: AccountWithBalance[];
  /** Активные команды — для подписи «Пользуются: Юра, Аня». */
  teams: Team[];
  onOpen: (href: string) => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  const rows = useMemo(() => sortAccountRows(accounts), [accounts]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={refreshControl}
    >
      {/* Ползунки справа уводят в НАСТРОЙКИ счетов: там заводят новый, меняют
          порядок строк и открывают закрытые. Панель отвечает «где лежат
          деньги», а управление живёт своей страницей — тот же закон, по
          которому шестерёнка списка ведёт на страницу его настроек. */}
      <PanelHeader
        title={`Счета · ${rows.length}`}
        onSettings={() => onOpen("/accounts/settings")}
        settingsLabel="Настройки счетов"
      />
      {rows.length === 0 ? (
        // Кнопка делает то, что называет: ведёт сразу в лист создания
        // (страница настроек откроет его сама по `?create=1`), а не на
        // страницу с ещё одной такой же кнопкой.
        <EmptyState
          title="У команды нет счетов"
          subtitle="Счёт — это касса или карта, где лежат деньги команды"
          action={{
            label: "Добавить счёт",
            onPress: () => onOpen("/accounts/settings?create=1"),
          }}
        />
      ) : (
        rows.map((account) => {
          return (
            <View key={account.id} style={{ marginBottom: 8 }}>
              <RowGroupBody first last>
                <SettingsRow
                  // Значок и цвет счёта — то, чем его узнают пальцем. Не
                  // выбраны: глиф по виду и без диска (`"neutral"`).
                  icon={accountIcon(account)}
                  tile={account.color ?? "neutral"}
                  title={account.name}
                  value={money(account.balance)}
                  valueColor={
                    moneySign(account.balance) < 0 ? t.danger : undefined
                  }
                  // Ноль тише живых денег — тем же правилом, что на самой
                  // странице счетов: иначе глаз не находит, где деньги.
                  // «Ноль» — по округлённым центам (moneySign), как всё,
                  // что напечатано.
                  valueQuiet={moneySign(account.balance) === 0}
                  onPress={() => onOpen(`/accounts/${account.id}`)}
                />
              </RowGroupBody>
            </View>
          );
        })
      )}
      {/* СТРОКИ «ВСЕ СЧЕТА» ЗДЕСЬ НЕТ (владелец 2026-08-12: «оно и так должно
          показывать все счета, которые есть на этой команде»). Панель и есть
          полный список счетов команды, а войти в счёт и править его можно с
          любой строки — вторая дверь вела бы к тому же списку и обещала бы, что
          выше показано не всё. */}
    </ScrollView>
  );
}
