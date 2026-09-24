import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  Building2,
  FileText,
  Percent,
  Receipt,
  Tags,
  Wallet,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useFeatureOn, useSetCompanyFeature } from "@/features/settings/company-features";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import {
  useSaveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
  vatSummaryLine,
} from "@/features/finances/vat-queries";
import { effectiveVatSettings } from "@babun/shared/local/finance/vat";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import { useFinanceTemplates } from "@/features/finances/templates-queries";
import {
  settingsTeamId,
  teamCategoriesLine,
  teamTemplatesLine,
} from "@/features/finances/team-settings-lines";
import { notify } from "@/lib/notify";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { accountsDoorLine } from "@/features/finances/accounts-sections";
import { useCurrentRole, useTenant, type Tenant } from "@/features/settings/tenant";
import { financeSettingsRows } from "@/features/finances/settings-rows";
import { LedgerExportRow } from "@/features/finances/LedgerExportRow";
import { useFinanceCategories } from "@/features/finances/queries";
import { formatInvoiceNumber } from "@/features/invoices/numbering";
import { useNextInvoiceNumber } from "@/features/invoices/queries";

/** Подпись строки: как будет выглядеть счёт, не проваливаясь внутрь — номер и
 *  главное решение генератора (строками или одной позицией).
 *
 *  НОМЕР БЕРЁТСЯ ОТТУДА ЖЕ, ОТКУДА ЕГО БЕРЁТ ВНУТРЕННЯЯ СТРАНИЦА (RPC
 *  `next_invoice_number`). Локальный `invoice_next_number` — это только
 *  «продолжить с номера», заданное руками: сервер гасит его после первого
 *  выпуска, и строка вечно показывала бы «INV-2026-001», пока внутренняя
 *  страница называет настоящий следующий номер. Два соседних экрана не имеют
 *  права называть разные номера одного документа. Образец из формата —
 *  запасной путь, когда RPC ещё не ответил или телефон офлайн. */
function invoiceLine(tenant: Tenant | undefined, nextNumber?: string | null): string {
  if (!tenant) return "Загрузка…";
  const sample = nextNumber ?? formatInvoiceNumber({
    prefix: tenant.invoice_prefix || "INV",
    year: new Date().getFullYear(),
    seq: tenant.invoice_next_number ?? 1,
    padding: tenant.invoice_number_padding,
    yearlyReset: tenant.invoice_number_yearly_reset,
  });
  const lines =
    tenant.invoice_line_source === "total" ? "одной строкой" : "услуги строками";
  const due =
    tenant.invoice_due_days === 0
      ? "оплата по факту"
      : `срок ${tenant.invoice_due_days} дн.`;
  return `${sample} · ${lines} · ${due}`;
}

// НАСТРОЙКИ ФИНАНСОВ — ПО КОМАНДЕ (владелец 2026-09-24: «надо сделать
// качественные настройки в финансах по каждой команде»; «у нас всё отдельно
// под каждую команду»).
//
// Устроено как настройки календаря: сверху лента команд, под ней — деньги
// ВЫБРАННОЙ команды (её счета, её категории и бюджеты, её шаблоны, её VAT).
// Ниже — то, что владелец оставил единым на компанию: бланк счёта клиенту,
// реквизиты (нумерация документов одна на компанию) и выгрузка бухгалтеру.
// Последним — функции: выключенное пропадает у всех, вместе со своими
// дверями.
//
// VAT — ФУНКЦИЯ, А НЕ ДВЕРЬ (владелец 2026-09-24: «VAT уже там по идее не
// нужен»). Не работаешь с налогом — один тумблер в «Функциях», и ни одной
// строки про VAT на странице нет. Работаешь — у каждой команды свой режим и
// ставка в её блоке денег.
//
// Было: шестерёнка открывала системный Alert с шестью строками — против
// закона продукта («настройка — всегда полноценная страница, лист — только
// действие»).

export default function FinanceSettingsScreen() {
  const router = useRouter();
  const vat = useVatSettings();
  const saveVat = useSaveVatSettings();
  const vatOverrides = useTeamVatOverrides();
  const tenant = useTenant();
  const nextNumber = useNextInvoiceNumber(new Date().getFullYear());
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ДОСТУПУ (владелец 20.09). Правило и
  // его причины — `features/finances/settings-rows.ts`.
  const debtsOn = useFeatureOn("debts");
  const accountsOn = useFeatureOn("accounts");
  const documentsOn = useFeatureOn("documents");
  const vatOn = !!vat.data && vat.data.mode !== "off";
  const setFeature = useSetCompanyFeature();
  // Выключенная функция уносит и свою дверь в настройки.
  const base = financeSettingsRows(useCurrentRole().data);
  const rows = {
    ...base,
    accounts: base.accounts && accountsOn,
    vat: base.vat && vatOn,
    invoices: base.invoices && documentsOn,
    requisites: base.requisites && documentsOn,
  };

  const { team: teamParam } = useLocalSearchParams<{ team?: string }>();
  const teams = useTeams().data ?? [];
  const teamId = settingsTeamId(teams, teamParam);
  const withTeam = (path: string, key = "team") =>
    (teamId ? `${path}?${key}=${encodeURIComponent(teamId)}` : path) as Href;

  // Полный список ради двух чисел — сколько счетов открыто и закрыто. Кэш
  // общий со страницей «Счета», так что дверь и страница не назовут разные
  // числа.
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const teamAccounts = (accounts.data ?? []).filter((a) => a.brigade_id === teamId);
  const categoriesQuery = useFinanceCategories();
  const templatesQuery = useFinanceTemplates();
  const teamTemplates = (templatesQuery.data ?? []).filter(
    (tpl) => tpl.brigade_id === teamId,
  ).length;
  const teamVat = effectiveVatSettings(
    vat.data,
    (vatOverrides.data ?? []).find((o) => o.teamId === teamId) ?? null,
    null,
  );

  const teamGroup = rows.accounts || rows.categories || rows.templates || rows.vat;
  const companyGroup = rows.invoices || rows.requisites || rows.templates;

  return (
    <Screen edges={["top"]}>
      {/* Шов под шапкой один — его несёт лента команд. */}
      <ScreenHeader title="Настройки финансов" seam={teams.length === 0} />
      {/* КОМАНДЫ СВЕРХУ, КАК В НАСТРОЙКАХ КАЛЕНДАРЯ: выбрана ровно одна —
          деньги правятся у конкретной команды. */}
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
              <SectionEyebrow>Деньги команды</SectionEyebrow>
              <SectionCard>
                {/* «СЧЕТА» — ТА ЖЕ СТРАНИЦА, ЧТО ЗА ПОЛЗУНКАМИ ПАНЕЛИ (владелец
                    2026-09-15): остатки, порядок, скрытие, «Добавить счёт» и
                    закрытые счета — всё там; здесь она открывается на этой
                    команде. РАЗДЕЛИТЕЛЬ ПРИНАДЛЕЖИТ СВОЕЙ СТРОКЕ и живёт под её
                    же условием: иначе погашенная строка оставляет висеть
                    волосинку. */}
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
                {rows.categories ? (
                  <>
                    {rows.accounts ? <Divider inset={56} /> : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.purple}
                      icon={Tags}
                      title="Категории и бюджеты"
                      sub={teamCategoriesLine(categoriesQuery.data ?? [], teamId)}
                      onPress={() => router.push(withTeam("/finances/categories"))}
                    />
                  </>
                ) : null}
                {rows.templates ? (
                  <>
                    {rows.accounts || rows.categories ? <Divider inset={56} /> : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.teal}
                      icon={Receipt}
                      title="Шаблоны операций"
                      sub={teamTemplatesLine(teamTemplates)}
                      onPress={() => router.push(withTeam("/finances/templates"))}
                    />
                  </>
                ) : null}
                {rows.vat ? (
                  <>
                    {rows.accounts || rows.categories || rows.templates ? (
                      <Divider inset={56} />
                    ) : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.red}
                      icon={Percent}
                      title="VAT"
                      sub={vatSummaryLine(teamVat)}
                      onPress={() => router.push(withTeam("/finances/vat-team", "teamId"))}
                    />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {companyGroup ? (
            <>
              {/* ЕДИНОЕ НА КОМПАНИЮ (владелец 2026-09-24): реквизиты и
                  нумерация документов одни на все команды — у налоговой один
                  продавец и одна нумерация. Выгрузка бухгалтеру — тоже по всей
                  компании. */}
              <SectionEyebrow>Вся компания</SectionEyebrow>
              <SectionCard>
                {rows.invoices ? (
                  <SettingsRow
                    tile={SETTINGS_TILE.blue}
                    icon={FileText}
                    title="Счета клиентам"
                    sub={invoiceLine(tenant.data, nextNumber.data)}
                    onPress={() => router.push("/finances/invoices")}
                  />
                ) : null}
                {rows.requisites ? (
                  <>
                    {rows.invoices ? <Divider inset={56} /> : null}
                    <SettingsRow
                      // Цветная плитка, как у соседей (прогон 2026-09-23): голый
                      // глиф в ряду плиток читался как строка другого рода.
                      tile={SETTINGS_TILE.green}
                      icon={Building2}
                      title="Реквизиты"
                      sub="Чем подписаны чеки и инвойсы"
                      onPress={() => router.push("/finances/requisites")}
                    />
                  </>
                ) : null}
                {rows.templates ? (
                  <>
                    {rows.invoices || rows.requisites ? <Divider inset={56} /> : null}
                    <LedgerExportRow />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {/* ФУНКЦИИ ДЕНЕГ (STORY-088, владелец 24.09: «тумблер — и его не
              будет ни у кого, даже у владельца»). Каждый тумблер — своя
              карточка, как в настройках календаря. Данные выключенной функции
              не стираются. */}
          {base.moneyGroup ? (
            <>
              <SectionEyebrow>Функции</SectionEyebrow>
              <SectionCard>
                <SwitchRow
                  label="Долги"
                  value={debtsOn}
                  onChange={(v) => setFeature.mutate({ key: "debts", on: v })}
                />
              </SectionCard>
              <SectionCard>
                <SwitchRow
                  label="Счета и переводы"
                  value={accountsOn}
                  onChange={(v) => setFeature.mutate({ key: "accounts", on: v })}
                />
              </SectionCard>
              <SectionCard>
                <SwitchRow
                  label="Инвойсы и чеки"
                  value={documentsOn}
                  onChange={(v) => setFeature.mutate({ key: "documents", on: v })}
                />
              </SectionCard>
              {/* VAT — тот же выключатель, что стоял на его странице
                  («Работаем с VAT»): выключен — налог нигде не спрашивается и
                  не считается; включён — режим и ставка у каждой команды. */}
              {vat.data ? (
                <SectionCard>
                  <SwitchRow
                    label="VAT"
                    value={vatOn}
                    onChange={(on) =>
                      saveVat.mutate(
                        { mode: on ? "inclusive" : "off" },
                        {
                          onError: (e) =>
                            notify("Не удалось сохранить", (e as Error).message),
                        },
                      )
                    }
                  />
                </SectionCard>
              ) : null}
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
