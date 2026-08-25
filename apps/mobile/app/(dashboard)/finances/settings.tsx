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
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import {
  useVatSettings,
  vatSummaryLine,
} from "@/features/finances/vat-queries";
import { useTenant, type Tenant } from "@/features/settings/tenant";
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

  return (
    <Screen>
      <ScreenHeader title="Настройки финансов" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionEyebrow>Деньги</SectionEyebrow>
        <SectionCard>
          {/* Дверь ведёт в НАСТРОЙКИ счетов, а не в список: список — это
              рабочий экран с деньгами, ему место во вкладке «Финансы», а
              страница настроек здесь и называется настройкой. */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Wallet}
            title="Настройки счетов"
            sub="Добавить счёт, порядок строк, закрытые счета"
            onPress={() => router.push("/accounts/settings")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Категории операций"
            sub="На что уходят и откуда приходят деньги"
            onPress={() => router.push("/cabinet/categories")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.teal}
            icon={Receipt}
            title="Шаблоны операций"
            sub="Повторяющиеся расходы в один тап"
            onPress={() => router.push("/cabinet/templates")}
          />
        </SectionCard>

        <SectionEyebrow>Документы</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.red}
            icon={Percent}
            title="НДС и страна"
            sub={vatSummaryLine(vat.data)}
            onPress={() => router.push("/finances/vat")}
          />
          <Divider inset={56} />
          {/* Списка счетов здесь нет: его открывает плитка «Документы» на
              «Финансах». Эта дверь — в НАСТРОЙКИ документа: что подставлять в
              новый счёт и какой у него номер. Оба вопроса про одну бумагу и
              живут на одной странице. */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={FileText}
            title="Счета клиентам"
            sub={invoiceLine(tenant.data, nextNumber.data)}
            onPress={() => router.push("/finances/invoices")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="neutral"
            icon={Building2}
            title="Реквизиты компании"
            sub="Печатаются в инвойсах и чеках"
            onPress={() => router.push("/cabinet/business")}
          />
        </SectionCard>

        {/* «Отчёта бухгалтеру» в продукте нет (владелец 2026-08-11). Сводный
            CSV за период не имел ни остатка на начало, ни на конец, поэтому не
            сводился ни с банком, ни с кассой. Формат, который бухгалтер
            действительно проверяет, — выписка по КОНКРЕТНОМУ счёту; она живёт
            на карточке счёта, где у неё есть эти границы. */}
      </ScrollView>
    </Screen>
  );
}
