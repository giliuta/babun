import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Handshake,
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
import { useSaveVatSettings, useVatSettings } from "@/features/finances/vat-queries";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import {
  settingsTeamId,
  teamCategoryKindLine,
} from "@/features/finances/team-settings-lines";
import { notify } from "@/lib/notify";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";
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
// Последним — функции: выключенное пропадает у всех, вместе с дверями.
//
// УБРАНО 30.09 по слову владельца: «Шаблоны операций» («не понимаю, что это,
// нужно ли вообще» — убрать совсем) и дверь VAT (ставку регулируем в «Итого»
// документа, она запоминается; страница не нужна).

type CategoryKind = "income" | "expense" | "debt";

export default function FinanceSettingsScreen() {
  const router = useRouter();
  const vat = useVatSettings();
  const tenantIdForVat = useTenantId();
  const saveVat = useSaveVatSettings();
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ДОСТУПУ (владелец 20.09). Правило и
  // его причины — `features/finances/settings-rows.ts`.
  const debtsOn = useFeatureOn("debts");
  const accountsOn = useFeatureOn("accounts");
  const documentsOn = useFeatureOn("documents");
  const vatOn = !!vat.data && vat.data.mode !== "off";
  // Тумблер функции при сбое откатывался молча (аудит 2026-09-30).
  const featureFailed = (e: unknown) =>
    notify("Не удалось сохранить", e instanceof Error ? e.message : String(e));
  const vatModeKey = `vat.lastMode.${tenantIdForVat ?? "none"}`;
  const lastVatMode = (): "inclusive" | "exclusive" => {
    const stored = getStorage().get<string>(vatModeKey);
    return stored === "exclusive" ? "exclusive" : "inclusive";
  };
  const rememberVatMode = (mode: "inclusive" | "exclusive") =>
    getStorage().set(vatModeKey, mode);
  const setFeature = useSetCompanyFeature();
  // Выключенная функция уносит и свою дверь в настройки.
  const base = financeSettingsRows(useCurrentRole().data);
  const rows = {
    ...base,
    accounts: base.accounts && accountsOn,
    requisites: base.requisites && documentsOn,
  };

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

  // КАТЕГОРИИ — ОТДЕЛЬНОЙ СТРАНИЦЕЙ НА ВИД (владелец 2026-09-30). Долги —
  // только когда функция «Долги» включена.
  const categoryDoors: { kind: CategoryKind; title: string; icon: typeof Wallet }[] = [
    { kind: "income", title: "Категории доходов", icon: ArrowDownLeft },
    { kind: "expense", title: "Категории расходов", icon: ArrowUpRight },
    ...(debtsOn
      ? [{ kind: "debt" as const, title: "Категории долгов", icon: Handshake }]
      : []),
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
                  onChange={(v) => setFeature.mutate({ key: "debts", on: v }, { onError: featureFailed })}
                />
              </SectionCard>
              <SectionCard>
                <SwitchRow
                  label="Счета и переводы"
                  value={accountsOn}
                  onChange={(v) => setFeature.mutate({ key: "accounts", on: v }, { onError: featureFailed })}
                />
              </SectionCard>
              <SectionCard>
                <SwitchRow
                  label="Инвойсы и чеки"
                  value={documentsOn}
                  onChange={(v) => setFeature.mutate({ key: "documents", on: v }, { onError: featureFailed })}
                />
              </SectionCard>
              {/* VAT — выключатель налога на весь аккаунт. Ставку и режим
                  документа решает «Итого» (владелец 2026-09-30). */}
              {vat.data ? (
                <SectionCard>
                  <SwitchRow
                    label="VAT"
                    value={vatOn}
                    onChange={(on) =>
                      saveVat.mutate(
                        // Включили снова — тем режимом, каким работали до
                        // выключения («плюсом» не сбрасывается в «в цене»).
                        { mode: on ? lastVatMode() : "off" },
                        {
                          onSuccess: () => {
                            if (!on && vat.data && vat.data.mode !== "off") {
                              rememberVatMode(vat.data.mode);
                            }
                          },
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

/** Дверь категорий одного вида — фиолетовая плитка справочника; разделитель
 *  принадлежит своей строке и живёт под её условием. */
function SettingsDoor({
  separated,
  title,
  icon,
  sub,
  onPress,
}: {
  separated: boolean;
  title: string;
  icon: typeof Wallet;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <>
      {separated ? <Divider inset={56} /> : null}
      <SettingsRow
        tile={SETTINGS_TILE.purple}
        icon={icon}
        title={title}
        sub={sub}
        onPress={onPress}
      />
    </>
  );
}
