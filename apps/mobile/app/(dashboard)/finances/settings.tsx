import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  HandCoins,
  NotebookPen,
  ReceiptText,
  Trash2,
  Wallet,
} from "lucide-react-native";
import type { FinanceCategoryKind } from "@babun/shared/db/repositories/finance-categories";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import {
  deletedOperationsDoorLine,
  settingsTeamId,
  teamCategoryKindLine,
} from "@/features/finances/team-settings-lines";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { accountsDoorLine } from "@/features/finances/accounts-sections";
import { useCurrentRole } from "@/session/tenant";
import { useCalendarChips } from "@/session/workspaces";
import {
  CATEGORY_KIND_ROW,
  anyFinanceSetting,
  type FinanceSettingRow,
} from "@/features/finances/settings-levels";
import { useFinanceSettingLevelsOf } from "@/features/finances/use-finance-settings";
import { CurrencySettingsRow } from "@/features/settings/CurrencySettingsRow";
import { RequisitesRow } from "@/features/companies/RequisitesRow";
import { useFinanceCategories } from "@/features/finances/queries";
import { useDeletedOperations } from "@/features/finances/deleted-operations";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

// НАСТРОЙКИ ФИНАНСОВ — ПО КОМАНДЕ: выбрал сверху команду — и это полностью её
// настройки.
//
// Сверху лента команд. Под ней — только выбранная команда: её счета (страница
// без своей ленты — команда уже выбрана) и «Удалённые операции», её категории
// доходов, расходов и долгов отдельными страницами.
//
// Ниже — «Общие»: валюта, одна на весь аккаунт.
//
// ВИД: имена блоков — внутри карточек, как в записи и в листе реквизитов;
// подписи дверей — коротко, живым состоянием («Евро · €»).
//
// НЕТ здесь: «Шаблонов операций», двери VAT (ставку регулируем в «Итого»
// документа, она запоминается; страница не нужна) и блока «Функции» с
// тумблерами долгов, счетов, документов и VAT: эти функции всегда включены
// (`ALWAYS_ON_FEATURES`), а VAT выбирается клавишами в самой операции и в
// «Итого» документа.
//
// КАТЕГОРИИ разделены на доходы, расходы и долги. Блоки с самими категориями
// внутри и плашки с числом справа не подходят: блок «Категории» — три строки «Доходы / Расходы / Долги» тем же видом, что
// «Счета» и «Реквизиты», каждая ведёт на свою страницу, где внизу «Добавить
// категорию».
// Блок команды назван «Деньги» — имя команды уже стоит в ленте над ним.
// БЛОК «ДОКУМЕНТЫ» — «Реквизиты» выбранного календаря: от чьего имени он
// выставляет инвойсы и чеки. Наборы одни на аккаунт, у каждого — свои
// календари; партнёр видит только наборы своих календарей.


const KINDS: {
  kind: FinanceCategoryKind;
  title: string;
  icon: typeof Wallet;
  tile: string;
}[] = [
  { kind: "income", title: "Доходы", icon: HandCoins, tile: SETTINGS_TILE.green },
  { kind: "expense", title: "Расходы", icon: ReceiptText, tile: SETTINGS_TILE.red },
  { kind: "debt", title: "Долги", icon: NotebookPen, tile: SETTINGS_TILE.yellow },
];

export default function FinanceSettingsScreen() {
  const router = useRouter();
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ПРАВАМ (у каждой строки
  // шестерёнки своё право). Правило и его причины —
  // `features/finances/settings-levels.ts`: «Скрыты» — строки нет, «Только
  // видит» — строка ведёт на страницу без правки, «Видит и меняет» — правит.
  const owner = useCurrentRole().data === "owner";
  const levelsOf = useFinanceSettingLevelsOf();

  const { team: teamParam } = useLocalSearchParams<{ team?: string }>();
  const allTeams = useTeams({ display: true }).data ?? [];
  // В ленте — команды, где у человека открыта хоть одна строка (у владельца —
  // все), как в шестерёнке клиентов.
  const teams = owner ? allTeams : allTeams.filter((team) => anyFinanceSetting(levelsOf(team.id)));
  const teamId = settingsTeamId(teams, teamParam);
  // ЛЕНТА — ВСЕ КАЛЕНДАРИ ВСЕХ АККАУНТОВ, КАК НАД ФИНАНСАМИ: сразу видны все
  // команды, доступ у каждой свой. Тап по календарю другого аккаунта переводит в него, и строки
  // ниже читаются по правам там.
  const toast = useToast();
  const chips = useCalendarChips({
    own: teams,
    onPickOwn: (id) => router.setParams({ team: id }),
    onSwitchError: (message) => toast(message, "error"),
  });
  const levels = levelsOf(teamId);
  const shown = (row: FinanceSettingRow) => levels[row] !== "hidden";
  const withTeam = (path: string, extra?: string) =>
    (teamId
      ? `${path}?team=${encodeURIComponent(teamId)}${extra ? `&${extra}` : ""}`
      : `${path}${extra ? `?${extra}` : ""}`) as Href;

  // Полный список ради двух чисел — сколько счетов видно и сколько скрыто. Кэш
  // общий со страницей «Счета», так что дверь и страница не назовут разные
  // числа.
  const accounts = useAccountsWithBalances({ includeInactive: true, includeHidden: true });
  const teamAccounts = (accounts.data ?? []).filter((a) => a.brigade_id === teamId);
  const categoriesQuery = useFinanceCategories();
  const deletedOperations = useDeletedOperations();

  const money = {
    accounts: shown("accounts"),
    trash: shown("trash"),
  };
  const moneyGroup = teamId !== null && (money.accounts || money.trash);
  const categoryKinds = teamId ? KINDS.filter(({ kind }) => shown(CATEGORY_KIND_ROW[kind])) : [];
  const requisites = teamId !== null && shown("requisites");
  const any = moneyGroup || categoryKinds.length > 0 || requisites || shown("currency");

  return (
    <Screen edges={["top"]}>
      {/* Шов под шапкой один — его несёт лента команд. */}
      <ScreenHeader title="Настройки финансов" seam={chips.items.length === 0} />
      {/* КОМАНДЫ СВЕРХУ, КАК В НАСТРОЙКАХ КАЛЕНДАРЯ: выбрана ровно одна —
          всё ниже неё — её. Лента стоит и там, где в этом аккаунте строк
          нет: через неё уходят в календарь, где они есть. */}
      {chips.items.length > 0 ? (
        <ScopeChips
          items={chips.items}
          activeId={chips.pendingId ?? teamId}
          onSelect={chips.pick}
        />
      ) : null}
      {any ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {moneyGroup ? (
            <SectionCard title="Деньги">
              {/* «СЧЕТА» — ТА ЖЕ СТРАНИЦА, ЧТО ЗА ПОЛЗУНКАМИ ПАНЕЛИ: остатки,
                  порядок, скрытие, «Добавить счёт»; открывается на этой
                  команде и своей ленты команд не несёт. */}
              {money.accounts ? (
                <SettingsRow
                  tile={SETTINGS_TILE.blue}
                  icon={Wallet}
                  title="Счета"
                  sub={
                    accounts.data
                      ? accountsDoorLine(
                          teamAccounts.filter((a) => a.is_active && !a.is_hidden).length,
                          teamAccounts.filter((a) => a.is_active && a.is_hidden).length,
                        )
                      : accountsDoorLine(undefined, undefined)
                  }
                  onPress={() => router.push(withTeam("/accounts/settings"))}
                />
              ) : null}
              {/* «УДАЛЁННЫЕ ОПЕРАЦИИ» — ящик этой команды:
                  30 дней, «Вернуть». Вид — как «Удалённые клиенты» в
                  шестерёнке клиентов. */}
              {money.trash ? (
                <>
                  {money.accounts ? <Divider inset={SETTINGS_ROW_INSET} /> : null}
                  <SettingsRow
                    tile={SETTINGS_TILE.red}
                    icon={Trash2}
                    title="Удалённые операции"
                    sub={
                      deletedOperations.data
                        ? deletedOperationsDoorLine(
                            deletedOperations.data.filter((item) => item.teamId === teamId).length,
                          )
                        : undefined
                    }
                    onPress={() => router.push(withTeam("/finances/deleted"))}
                  />
                </>
              ) : null}
            </SectionCard>
          ) : null}

          {/* КАТЕГОРИИ — ТРИ СТРОКИ, КАК «СЧЕТА», «РЕКВИЗИТЫ» И «ИНВОЙСЫ»
              (обычный блок, как все: доходы, расходы, долги). Каждая ведёт на свою страницу вида, там внизу «Добавить
              категорию». Подпись — сколько категорий у команды. */}
          {categoryKinds.length > 0 ? (
            <SectionCard title="Категории">
              {categoryKinds.map(({ kind, title, icon, tile }, index) => (
                <View key={kind}>
                  {index > 0 ? <Divider inset={SETTINGS_ROW_INSET} /> : null}
                  <SettingsRow
                    tile={tile}
                    icon={icon}
                    title={title}
                    sub={
                      categoriesQuery.data
                        ? teamCategoryKindLine(categoriesQuery.data, teamId, kind)
                        : undefined
                    }
                    onPress={() => router.push(withTeam("/finances/categories", `kind=${kind}`))}
                  />
                </View>
              ))}
            </SectionCard>
          ) : null}

          {requisites && teamId ? (
            <SectionCard title="Документы">
              <RequisitesRow teamId={teamId} />
            </SectionCard>
          ) : null}

          {/* ВАЛЮТА — ОДНА НА ВЕСЬ АККАУНТ. */}
          {shown("currency") ? (
            <SectionCard title="Общие">
              <CurrencySettingsRow readOnly={levels.currency !== "write"} />
            </SectionCard>
          ) : null}
        </ScrollView>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний).
        <EmptyState fill title="Настроек пока нет" />
      )}
    </Screen>
  );
}
