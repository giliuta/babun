import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  Building2,
  HandCoins,
  NotebookPen,
  ReceiptText,
  Wallet,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import {
  settingsTeamId,
  teamCategoryKindLine,
} from "@/features/finances/team-settings-lines";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { accountsDoorLine } from "@/features/finances/accounts-sections";
import { useCurrentRole } from "@/features/settings/tenant";
import { financeSettingsRows } from "@/features/finances/settings-rows";
import { LedgerExportRow } from "@/features/finances/LedgerExportRow";
import { CurrencySettingsRow } from "@/features/settings/CurrencySettingsRow";
import { useFinanceCategories } from "@/features/finances/queries";

// НАСТРОЙКИ ФИНАНСОВ — ПО КОМАНДЕ (владелец 2026-09-30: «перешёл сверху в
// команду один — и это полностью настройки чётко под команду один»).
//
// Сверху лента команд. Под ней — только выбранная команда: её счета (страница
// без своей ленты — команда уже выбрана), её категории доходов, расходов и
// долгов отдельными страницами и выгрузка её операций бухгалтеру.
//
// Ниже — «Общие»: валюта (одна на весь аккаунт) и реквизиты — общий список,
// номер инвойса живёт за каждым набором реквизитов, там же бланк счёта
// («Счета клиентам» переехали туда).
//
// УБРАНО 30.09 по слову владельца: «Шаблоны операций» («не понимаю, что это,
// нужно ли вообще» — убрать совсем), дверь VAT (ставку регулируем в «Итого»
// документа, она запоминается; страница не нужна) и блок «Функции» с
// тумблерами долгов, счетов, документов и VAT («это мы полностью удаляем, у
// нас должно быть всё включено»): эти функции теперь всегда включены
// (`ALWAYS_ON_FEATURES`), а VAT выбирается клавишами в самой операции и в
// «Итого» документа.

type CategoryKind = "income" | "expense" | "debt";

export default function FinanceSettingsScreen() {
  const router = useRouter();
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ДОСТУПУ (владелец 20.09). Правило и
  // его причины — `features/finances/settings-rows.ts`.
  const rows = financeSettingsRows(useCurrentRole().data);

  const { team: teamParam } = useLocalSearchParams<{ team?: string }>();
  const teams = useTeams().data ?? [];
  const teamId = settingsTeamId(teams, teamParam);
  const withTeam = (path: string, extra?: string) =>
    (teamId
      ? `${path}?team=${encodeURIComponent(teamId)}${extra ? `&${extra}` : ""}`
      : `${path}${extra ? `?${extra}` : ""}`) as Href;

  // Полный список ради двух чисел — сколько счетов открыто и закрыто. Кэш
  // общий со страницей «Счета», так что дверь и страница не назовут разные
  // числа.
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const teamAccounts = (accounts.data ?? []).filter((a) => a.brigade_id === teamId);
  const categoriesQuery = useFinanceCategories();

  // КАТЕГОРИИ — ОТДЕЛЬНОЙ СТРАНИЦЕЙ НА ВИД (владелец 2026-09-30).
  //
  // ЗНАЧКИ — ПО СМЫСЛУ ДЕНЕГ (владелец 30.09: «значки вот эти переделай»).
  // Были три фиолетовые стрелки и рукопожатие: одинаковые пятна, которые не
  // говорили, где доход, а где расход. Теперь цвет — тот же, что у плиток
  // главной «Финансов» (доход зелёный, расход красный, долги янтарные), а
  // глиф — сам предмет: монеты в руку, чек (строками, без знака валюты — у Receipt там «$»), тетрадь долгов.
  const categoryDoors: {
    kind: CategoryKind;
    title: string;
    icon: typeof Wallet;
    tile: string;
  }[] = [
    { kind: "income", title: "Категории доходов", icon: HandCoins, tile: SETTINGS_TILE.green },
    { kind: "expense", title: "Категории расходов", icon: ReceiptText, tile: SETTINGS_TILE.red },
    { kind: "debt", title: "Категории долгов", icon: NotebookPen, tile: SETTINGS_TILE.yellow },
  ];
  const categoryLine = (kind: CategoryKind): string | undefined =>
    // Пока категории едут — без подписи: «Пока нет» на загрузке врало бы.
    categoriesQuery.data ? teamCategoryKindLine(categoriesQuery.data, teamId, kind) : undefined;

  const teamGroup = rows.accounts || rows.categories || rows.moneyGroup;
  const commonGroup = rows.currency || rows.requisites;

  return (
    <Screen edges={["top"]}>
      {/* Шов под шапкой один — его несёт лента команд. */}
      <ScreenHeader title="Настройки финансов" seam={teams.length === 0} />
      {/* КОМАНДЫ СВЕРХУ, КАК В НАСТРОЙКАХ КАЛЕНДАРЯ: выбрана ровно одна —
          всё ниже неё — её. */}
      {rows.any && teams.length > 0 ? (
        <ScopeChips
          items={teams}
          activeId={teamId}
          onSelect={(id) => router.setParams({ team: id })}
        />
      ) : null}
      {rows.any ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {teamGroup && teamId ? (
            <>
              <SectionEyebrow>
                {teams.find((team) => team.id === teamId)?.name ?? "Команда"}
              </SectionEyebrow>
              <SectionCard>
                {/* «СЧЕТА» — ТА ЖЕ СТРАНИЦА, ЧТО ЗА ПОЛЗУНКАМИ ПАНЕЛИ: остатки,
                    порядок, скрытие, «Добавить счёт»; открывается на этой
                    команде и своей ленты команд не несёт. */}
                {rows.accounts ? (
                  <SettingsRow
                    tile={SETTINGS_TILE.blue}
                    icon={Wallet}
                    title="Счета"
                    sub={
                      accounts.data
                        ? accountsDoorLine(
                            teamAccounts.filter((a) => a.is_active).length,
                            teamAccounts.filter((a) => !a.is_active).length,
                          )
                        : accountsDoorLine(undefined, undefined)
                    }
                    onPress={() => router.push(withTeam("/accounts/settings"))}
                  />
                ) : null}
                {rows.categories
                  ? categoryDoors.map((door, index) => (
                      <SettingsDoor
                        key={door.kind}
                        separated={rows.accounts || index > 0}
                        title={door.title}
                        icon={door.icon}
                        tile={door.tile}
                        sub={categoryLine(door.kind)}
                        onPress={() =>
                          router.push(withTeam("/finances/categories", `kind=${door.kind}`))
                        }
                      />
                    ))
                  : null}
                {/* ВЫГРУЗКА — ТОЛЬКО ЭТОЙ КОМАНДЫ (владелец 2026-09-30). */}
                {rows.moneyGroup ? (
                  <>
                    {rows.accounts || rows.categories ? <Divider inset={56} /> : null}
                    <LedgerExportRow teamId={teamId} />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {commonGroup ? (
            <>
              {/* ОБЩЕЕ НА ВЕСЬ АККАУНТ (владелец 2026-09-30): валюта одна для
                  всего; реквизиты — общий список, номер инвойса за каждым
                  набором. */}
              <SectionEyebrow>Общие</SectionEyebrow>
              <SectionCard>
                {rows.currency ? <CurrencySettingsRow /> : null}
                {rows.requisites ? (
                  <>
                    {rows.currency ? <Divider inset={56} /> : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.green}
                      icon={Building2}
                      title="Реквизиты"
                      sub="Номер инвойса и бланк счёта"
                      onPress={() => router.push("/finances/requisites")}
                    />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

        </ScrollView>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}
    </Screen>
  );
}

/** Дверь категорий одного вида — плитка цвета своих денег; разделитель
 *  принадлежит своей строке и живёт под её условием. */
function SettingsDoor({
  separated,
  title,
  icon,
  tile,
  sub,
  onPress,
}: {
  separated: boolean;
  title: string;
  icon: typeof Wallet;
  tile: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <>
      {separated ? <Divider inset={56} /> : null}
      <SettingsRow
        tile={tile}
        icon={icon}
        title={title}
        sub={sub}
        onPress={onPress}
      />
    </>
  );
}
