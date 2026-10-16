import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { VatSettings } from "@babun/shared/local/finance/vat";
import type {
  InvoiceLedgerWithLines,
  InvoiceLineDraft,
  InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import type { InvoiceGeneratorSettings } from "@babun/shared/local/finance/invoice-generator";
import type { Service } from "@/features/services/queries";
import type { Team } from "@/features/reference/queries";
import type { Tenant } from "@/session/tenant";
import type { InvoiceLanguage } from "@/lib/paper/dictionary";

export interface InvoicePrefill {
  transactionId?: string | null;
  clientId?: string | null;
  appointmentId?: string | null;
  teamId?: string | null;
  amount?: number | null;
  title?: string | null;
  issuedOn?: string | null;
}

export interface InvoiceEditorValue {
  issued_on: string;
  due_on: string | null;
  client_id: string | null;
  appointment_id: string | null;
  brigade_id: string | null;
  vat_mode: InvoiceVatMode;
  vat_percent: number;
  lines: InvoiceLineDraft[];
  /** Язык бумаги — пишется вторым шагом после выставления (см. queries). */
  language?: InvoiceLanguage;
  notes: string | null;
  link_to_tx_id: string | null;
  /** Набор реквизитов, которым подписан счёт. `null` — сервер подставит
   *  основные (`resolve_company_id`, миграция 20260921000000). */
  company_id: string | null;
  /** Объект клиента, под который выписан счёт (миграция 20260922060000). */
  location_id?: string | null;
  /** Набор реквизитов клиента (миграция 20260922100000); `null` — основной. */
  client_requisites_id?: string | null;
  /** Счёт, на который ждём деньги. */
  account_id: string | null;
}

export interface InvoiceEditorProps {
  prefill?: InvoicePrefill;
  /** ПРАВКА ВЫСТАВЛЕННОГО СЧЁТА НА МЕСТЕ — пока клиенту не отправлен. Форма
   *  рождается из документа; номер и
   *  реквизиты продавца не меняются, кнопка — «Сохранить инвойс». */
  existing?: InvoiceLedgerWithLines | null;
  /** Действующий НДС по команде (счёт → команда → компания, счёта у инвойса
   *  нет). Резолвер тот же, что у операций: греческая команда получает свои
   *  24%, а не кипрский дефолт компании. */
  vatForTeam: (teamId: string | null) => VatSettings;
  clients: Client[];
  appointments: Appointment[];
  /** Справочник услуг — из него генератор берёт названия строк. */
  services: Service[];
  /** Правила генератора: срок, строки, приписка (настройки компании). */
  generator: InvoiceGeneratorSettings;
  teams: Team[];
  businessToday: string;
  /** Реквизиты и логотип компании — их печатает документ. */
  tenant?: Tenant;
  submitting: boolean;
  onSubmit: (value: InvoiceEditorValue) => Promise<void>;
  /** «В форме есть несохранённое» — наружу, к кнопке «Назад». Экран сам
   *  спрашивает, уходить ли: молча стирать заполненный счёт нельзя. */
  onDirtyChange?: (dirty: boolean) => void;
}
