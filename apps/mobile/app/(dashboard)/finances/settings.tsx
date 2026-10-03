import { useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Building2, FileText, Wallet } from "lucide-react-native";
import type { FinanceCategoryKind } from "@babun/shared/db/repositories/finance-categories";
import { money } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import {
  invoicesDoorLine,
  requisitesDoorLine,
  settingsTeamId,
} from "@/features/finances/team-settings-lines";
import { useCompanies } from "@/features/companies/queries";
import { useNextInvoiceNumber } from "@/features/invoices/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { accountsDoorLine } from "@/features/finances/accounts-sections";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
import { useCurrency } from "@/features/settings/currency";
import { financeSettingsRows } from "@/features/finances/settings-rows";
import { LedgerExportRow } from "@/features/finances/LedgerExportRow";
import { CurrencySettingsRow } from "@/features/settings/CurrencySettingsRow";
import { useFinanceCategories } from "@/features/finances/queries";
import { useCategoryMonthSpend } from "@/features/finances/use-category-budget";
import { CategoryKindBlock } from "@/features/finances/CategoryKindBlock";
import {
  CategoryEditorSheet,
  type CategoryEditorTarget,
} from "@/features/finances/CategoryEditorSheet";

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
// ВИД 30.09 (владелец: «делай шестерёнку»): имена блоков — внутри карточек,
// как в записи и в листе реквизитов; категории — один блок из трёх плиток
// «Доходы | Расходы | Долги» с числом, вместо трёх одинаковых строк;
// подписи дверей — коротко: «CSV за период», «Евро · €», «1 набор ·
// INV-2026-005».
//
// УБРАНО 30.09 по слову владельца: «Шаблоны операций» («не понимаю, что это,
// нужно ли вообще» — убрать совсем), дверь VAT (ставку регулируем в «Итого»
// документа, она запоминается; страница не нужна) и блок «Функции» с
// тумблерами долгов, счетов, документов и VAT («это мы полностью удаляем, у
// нас должно быть всё включено»): эти функции теперь всегда включены
// (`ALWAYS_ON_FEATURES`), а VAT выбирается клавишами в самой операции и в
// «Итого» документа.
//
// ВИД 03.10 (владелец: «разделите категории — доход, расход, долги, — но не
// так, как сейчас, это ужасно»; выбран вариант 2): у каждого вида свой блок с
// самими категориями (`CategoryKindBlock`) — тап правит категорию шторкой
// поверх шестерёнки, «+» заводит новую, «Ещё N» ведёт на страницу вида.
// Блок команды назван «Деньги» — имя команды уже стоит в ленте над ним. Бланк
// инвойса вышел из-за шестерёнки «Реквизитов» сюда дверью «Инвойсы», рядом с
// «Реквизитами» в блоке «Документы»: у настройки одна дверь в её разделе.


const KINDS: { kind: FinanceCategoryKind; title: string }[] = [
  { kind: "income", title: "Доходы" },
  { kind: "expense", title: "Расходы" },
  { kind: "debt", title: "Долги" },
];

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

  // Полный список ради двух чисел — сколько счетов видно и сколько скрыто. Кэш
  // общий со страницей «Счета», так что дверь и страница не назовут разные
  // числа.
  const accounts = useAccountsWithBalances({ includeInactive: true, includeHidden: true });
  const teamAccounts = (accounts.data ?? []).filter((a) => a.brigade_id === teamId);
  const categoriesQuery = useFinanceCategories();
  const teamCategories = (categoriesQuery.data ?? []).filter((c) => c.team_id === teamId);
  // Траты месяца — для бюджета у плашек расхода, тем же запросом, что страница.
  const spend = useCategoryMonthSpend(rows.categories);
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const companies = useCompanies();
  const nextInvoice = useNextInvoiceNumber(new Date().getFullYear()).data;
  const liveSets = (companies.data ?? []).filter((c) => !c.archived_at).length;
  const tenant = useTenant().data;
  const [editor, setEditor] = useState<CategoryEditorTarget | null>(null);

  const teamGroup = rows.accounts || rows.moneyGroup;
  const documentsGroup = rows.requisites || rows.invoices;

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
            <SectionCard title="Деньги">
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
                          teamAccounts.filter((a) => a.is_active && !a.is_hidden).length,
                          teamAccounts.filter((a) => a.is_active && a.is_hidden).length,
                        )
                      : accountsDoorLine(undefined, undefined)
                  }
                  onPress={() => router.push(withTeam("/accounts/settings"))}
                />
              ) : null}
              {/* ВЫГРУЗКА — ТОЛЬКО ЭТОЙ КОМАНДЫ (владелец 2026-09-30). */}
              {rows.moneyGroup ? (
                <>
                  {rows.accounts ? <Divider inset={56} /> : null}
                  <LedgerExportRow teamId={teamId} />
                </>
              ) : null}
            </SectionCard>
          ) : null}

          {/* КАТЕГОРИИ КОМАНДЫ — ПО БЛОКУ НА ВИД (владелец 03.10, вариант 2).
              Пока список едет, блоков нет: «Пока нет» на загрузке врало бы. */}
          {rows.categories && teamId && categoriesQuery.data
            ? KINDS.map(({ kind, title }) => (
                <CategoryKindBlock
                  key={kind}
                  title={title}
                  kind={kind}
                  categories={teamCategories.filter((c) => c.type === kind)}
                  spend={spend}
                  fmt={fmt}
                  onEdit={(category) => setEditor({ mode: "edit", category })}
                  onAdd={() => setEditor({ mode: "create", kind, teamId })}
                  onOpenAll={() => router.push(withTeam("/finances/categories", `kind=${kind}`))}
                />
              ))
            : null}

          {/* ДОКУМЕНТЫ — ОДНО НА ВЕСЬ АККАУНТ: реквизиты (номер инвойса за
              каждым набором) и бланк инвойса — что подставлять в новый счёт. */}
          {documentsGroup ? (
            <SectionCard title="Документы">
              {rows.requisites ? (
                <SettingsRow
                  tile={SETTINGS_TILE.green}
                  icon={Building2}
                  title="Реквизиты"
                  sub={companies.data ? requisitesDoorLine(liveSets, nextInvoice) : undefined}
                  onPress={() => router.push("/finances/requisites")}
                />
              ) : null}
              {rows.invoices ? (
                <>
                  {rows.requisites ? <Divider inset={56} /> : null}
                  <SettingsRow
                    tile={SETTINGS_TILE.blue}
                    icon={FileText}
                    title="Инвойсы"
                    sub={tenant ? invoicesDoorLine(tenant.invoice_due_days) : undefined}
                    onPress={() => router.push("/finances/invoice-blank")}
                  />
                </>
              ) : null}
            </SectionCard>
          ) : null}

          {/* ВАЛЮТА — ОДНА НА ВЕСЬ АККАУНТ (владелец 2026-09-30). */}
          {rows.currency ? (
            <SectionCard title="Общие">
              <CurrencySettingsRow />
            </SectionCard>
          ) : null}
        </ScrollView>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}
      <CategoryEditorSheet target={editor} onClose={() => setEditor(null)} />
    </Screen>
  );
}
