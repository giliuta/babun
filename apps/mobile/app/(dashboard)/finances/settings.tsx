import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
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
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import {
  useVatSettings,
  vatSummaryLine,
} from "@/features/finances/vat-queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { accountsDoorLine } from "@/features/finances/accounts-sections";
import { useCurrentRole, useTenant, type Tenant } from "@/features/settings/tenant";
import { financeSettingsRows } from "@/features/finances/settings-rows";
import { LedgerExportRow } from "@/features/finances/LedgerExportRow";
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

// НАСТРОЙКИ ФИНАНСОВ — СТРАНИЦА, А НЕ СПИСОК В ALERT.
//
// Было: шестерёнка открывала системный Alert с шестью строками. Это против
// закона продукта («настройка — всегда полноценная страница, лист — только
// действие»), и вдобавок Alert не умеет ни подписей, ни текущих значений:
// нельзя было увидеть, включён ли НДС, не проваливаясь внутрь.

export default function FinanceSettingsScreen() {
  const router = useRouter();
  const vat = useVatSettings();
  const tenant = useTenant();
  const nextNumber = useNextInvoiceNumber(new Date().getFullYear());
  // Полный список ради двух чисел — сколько счетов открыто и закрыто. Кэш
  // общий со страницей «Счета», так что дверь и страница не назовут разные
  // числа.
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ДОСТУПУ (владелец 20.09). Правило и
  // его причины — `features/finances/settings-rows.ts`.
  const rows = financeSettingsRows(useCurrentRole().data);
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const openCount = accounts.data?.filter((a) => a.is_active).length;
  const closedCount = accounts.data?.filter((a) => !a.is_active).length;

  return (
    <Screen>
      <ScreenHeader title="Настройки финансов" />
      {rows.any ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          {rows.moneyGroup ? (
            <>
              <SectionEyebrow>Деньги</SectionEyebrow>
              <SectionCard>
                {/* «СЧЕТА» — ТА ЖЕ СТРАНИЦА, ЧТО ЗА ПОЛЗУНКАМИ ПАНЕЛИ (владелец
                    2026-09-15: «эту настройку поставь в шестерёнку, и там счета,
                    чтоб была одна и та же страница»). Остатки, порядок, скрытие,
                    «Добавить счёт» и закрытые счета — всё там; двух разных
                    страниц счетов у продукта нет.
                    Соседство с «Счетами клиентам» ниже различают подписи: здесь
                    числа счетов, там номер следующего инвойса.
                    РАЗДЕЛИТЕЛЬ ПРИНАДЛЕЖИТ СВОЕЙ СТРОКЕ и живёт под её же
                    условием: иначе погашенная строка оставляет висеть волосинку. */}
                {rows.accounts ? (
                  <SettingsRow
                    tile={SETTINGS_TILE.blue}
                    icon={Wallet}
                    title="Счета"
                    sub={accountsDoorLine(openCount, closedCount)}
                    onPress={() => router.push("/accounts/settings")}
                  />
                ) : null}
                {rows.categories ? (
                  <>
                    {rows.accounts ? <Divider inset={56} /> : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.purple}
                      icon={Tags}
                      title="Категории операций"
                      sub="На что уходят и откуда приходят деньги"
                      onPress={() => router.push("/finances/categories")}
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
                      sub="Повторяющиеся расходы в один тап"
                      onPress={() => router.push("/finances/templates")}
                    />
                  </>
                ) : null}
                {rows.templates ? (
                  <>
                    <Divider inset={56} />
                    <LedgerExportRow />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {rows.documentsGroup ? (
            <>
              <SectionEyebrow>Документы</SectionEyebrow>
              <SectionCard>
                {rows.vat ? (
                  <SettingsRow
                    tile={SETTINGS_TILE.red}
                    icon={Percent}
                    // ПРОСТО «НДС»: страны на этой странице нет и не было — она
                    // живёт в «Реквизитах компании» (`cabinet/business.tsx`),
                    // рядом с адресом и телефоном. Дверь обещала настройку,
                    // которой за ней нет, и человек шёл искать страну туда, где
                    // её никогда не стояло.
                    title="VAT"
                    sub={vatSummaryLine(vat.data)}
                    onPress={() => router.push("/finances/vat")}
                  />
                ) : null}
                {/* Списка счетов здесь нет: его открывает плитка «Документы» на
                    «Финансах». Эта дверь — в НАСТРОЙКИ документа: что подставлять
                    в новый счёт и какой у него номер. Оба вопроса про одну бумагу
                    и живут на одной странице. */}
                {rows.invoices ? (
                  <>
                    {rows.vat ? <Divider inset={56} /> : null}
                    <SettingsRow
                      tile={SETTINGS_TILE.blue}
                      icon={FileText}
                      title="Счета клиентам"
                      sub={invoiceLine(tenant.data, nextNumber.data)}
                      onPress={() => router.push("/finances/invoices")}
                    />
                  </>
                ) : null}
                {rows.requisites ? (
                  <>
                    {rows.vat || rows.invoices ? <Divider inset={56} /> : null}
                    <SettingsRow
                      // Цветная плитка, как у соседей (прогон 2026-09-23):
                      // голый глиф в ряду плиток читался как строка другого
                      // рода. Зелёный — «наружу и вовне»: этим подписаны
                      // документы клиенту.
                      tile={SETTINGS_TILE.green}
                      icon={Building2}
                      title="Реквизиты"
                      sub="Чем подписаны чеки и инвойсы"
                      onPress={() => router.push("/finances/requisites")}
                    />
                  </>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {/* «Отчёта бухгалтеру» в продукте нет (владелец 2026-08-11). Сводный
              CSV за период не имел ни остатка на начало, ни на конец, поэтому не
              сводился ни с банком, ни с кассой. Выписку по счёту владелец
              2026-09-15 тоже снял со страницы счёта («никаких кнопок внутри»),
              так что сюда её не возвращаем без его слова. */}
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
