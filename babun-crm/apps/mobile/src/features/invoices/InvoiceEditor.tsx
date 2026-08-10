import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import {
  calculateInvoiceTotals,
  type InvoiceLedgerWithLines,
  type InvoiceLineDraft,
  type InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ValueRow } from "@/components/ui/ValueRow";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { EntityPickerSheet } from "./EntityPickerSheet";
import { InvoiceDateRow } from "./InvoiceDateRow";
import {
  InvoiceLineEditor,
  type EditableInvoiceLine,
} from "./InvoiceLineEditor";
import {
  addDaysYmd,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceVatMode,
  parseDecimal,
  parseMoneyAmount,
} from "./format";

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
  notes: string | null;
  link_to_tx_id: string | null;
}

// ОДИН ЯЗЫК НАЛОГА НА ВЕСЬ ПРОДУКТ. В листе операции стоят те же три клавиши
// теми же словами: «VAT» латиницей и «Сверху» — это второй словарь для одного
// и того же решения (владелец 2026-08-09).
const VAT_OPTIONS = [
  { value: "off", label: "Без НДС" },
  { value: "inclusive", label: "НДС включён" },
  { value: "exclusive", label: "Плюс НДС" },
] as const;

export function InvoiceEditor({
  initial,
  prefill,
  defaultVatMode,
  defaultVatPercent,
  clients,
  appointments,
  teams,
  businessToday,
  submitting,
  onSubmit,
}: {
  initial?: InvoiceLedgerWithLines;
  prefill?: InvoicePrefill;
  defaultVatMode: InvoiceVatMode;
  /** Ставка компании/команды. 0 — берём привычные 19. */
  defaultVatPercent?: number;
  clients: Client[];
  appointments: Appointment[];
  teams: Team[];
  businessToday: string;
  submitting: boolean;
  onSubmit: (value: InvoiceEditorValue) => Promise<void>;
}) {
  const t = useThemeColors();
  const serial = useRef(0);
  const newLine = (title = "", qty = "1", price = "") => ({
    id: `invoice-line-${serial.current++}`,
    title,
    qty,
    unitPrice: price,
  });

  // Future issue dates remain intentionally available (the server permits
  // scheduled documents), but a new document always starts on tenant today.
  const firstIssuedOn = initial?.issued_on ?? prefill?.issuedOn ?? businessToday;
  const [issuedOn, setIssuedOn] = useState(firstIssuedOn);
  const [dueOn, setDueOn] = useState<string | null>(
    initial?.due_on ?? addDaysYmd(firstIssuedOn, 7),
  );
  const [clientId, setClientId] = useState<string | null>(
    initial?.client_id ?? prefill?.clientId ?? null,
  );
  const [appointmentId, setAppointmentId] = useState<string | null>(
    initial?.appointment_id ?? prefill?.appointmentId ?? null,
  );
  const [teamId, setTeamId] = useState<string | null>(
    initial?.brigade_id ?? prefill?.teamId ?? null,
  );
  const [vatMode, setVatMode] = useState<InvoiceVatMode>(
    initial ? invoiceVatMode(initial) : defaultVatMode,
  );
  const [vatPercent, setVatPercent] = useState(
    String(initial?.vat_percent || defaultVatPercent || 19),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<EditableInvoiceLine[]>(() =>
    initial
      ? initial.lines.map((line) =>
          newLine(line.title, String(line.qty), String(line.unit_price)),
        )
      : [
          newLine(
            prefill?.title?.trim() || "Услуги",
            "1",
            prefill?.amount && prefill.amount > 0 ? String(prefill.amount) : "",
          ),
        ],
  );
  const [picker, setPicker] = useState<"client" | "appointment" | "team" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const selectedClient = clientId ? clientById.get(clientId) : null;
  const selectedAppointment = appointments.find((item) => item.id === appointmentId);
  const selectedTeam = teams.find((team) => team.id === teamId);

  const parsedLines = useMemo<InvoiceLineDraft[]>(
    () =>
      lines.map((line) => ({
        title: line.title.trim(),
        qty: parseDecimal(line.qty) ?? 0,
        unit_price: parseMoneyAmount(line.unitPrice) ?? -1,
      })),
    [lines],
  );
  const rate = vatMode === "off" ? 0 : (parseMoneyAmount(vatPercent) ?? -1);
  const totals = calculateInvoiceTotals(
    parsedLines.filter((line) => line.qty > 0 && line.unit_price >= 0),
    vatMode,
    Math.max(0, rate),
  );

  const setLine = (next: EditableInvoiceLine) =>
    setLines((current) => current.map((line) => (line.id === next.id ? next : line)));

  const selectAppointment = (id: string | null) => {
    setAppointmentId(id);
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment) return;
    setClientId(appointment.client_id);
    setTeamId(appointment.team_id);
    if (
      appointment.total_amount > 0 &&
      lines.length === 1 &&
      (!lines[0].unitPrice || Number(lines[0].unitPrice) === 0)
    ) {
      setLines([{
        ...lines[0],
        title: lines[0].title.trim() || "Услуги по заявке",
        unitPrice: String(appointment.total_amount),
      }]);
    }
  };

  const submit = async () => {
    setError(null);
    if (parsedLines.some((line) => !line.title || line.qty <= 0 || line.unit_price < 0)) {
      setError("Проверьте название, количество и цену каждой позиции.");
      return;
    }
    if (totals.total <= 0) {
      setError("Итог инвойса должен быть больше нуля.");
      return;
    }
    if (rate < 0 || rate > 100) {
      setError("Ставка НДС должна быть от 0 до 100% и не больше двух знаков.");
      return;
    }
    try {
      await onSubmit({
        issued_on: issuedOn,
        due_on: dueOn,
        client_id: clientId,
        appointment_id: appointmentId,
        brigade_id: teamId,
        vat_mode: vatMode,
        vat_percent: rate,
        lines: parsedLines,
        notes: notes.trim() || null,
        link_to_tx_id: initial ? null : prefill?.transactionId ?? null,
      });
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard title="Получатель">
          <ValueRow
            label="Клиент"
            value={selectedClient?.full_name || "Не выбран"}
            muted={!selectedClient}
            onPress={() => setPicker("client")}
          />
          <ValueRow
            label="Заявка"
            value={
              selectedAppointment
                ? `${formatInvoiceDate(selectedAppointment.date)} · ${selectedAppointment.time_start}`
                : "Не привязана"
            }
            muted={!selectedAppointment}
            onPress={() => setPicker("appointment")}
          />
          <ValueRow
            label="Команда"
            value={selectedTeam?.name || "Не выбрана"}
            muted={!selectedTeam}
            onPress={() => setPicker("team")}
          />
        </SectionCard>

        <SectionCard title="Даты">
          {initial ? (
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text className="text-base" style={{ color: t.ink }}>Дата выставления</Text>
              <Text className="text-base" style={{ color: t.sub }}>{formatInvoiceDate(issuedOn)}</Text>
            </View>
          ) : (
            <InvoiceDateRow
              label="Дата выставления"
              value={issuedOn}
              onChange={(value) => {
                if (!value) return;
                setIssuedOn(value);
                if (dueOn && dueOn < value) setDueOn(value);
              }}
            />
          )}
          <InvoiceDateRow
            label="Оплатить до"
            value={dueOn}
            optional
            minimum={issuedOn}
            onChange={setDueOn}
          />
        </SectionCard>

        <SectionCard title="Позиции" padded>
          <View style={{ gap: 10 }}>
            {lines.map((line) => (
              <InvoiceLineEditor
                key={line.id}
                line={line}
                canRemove={lines.length > 1}
                onChange={setLine}
                onRemove={() => setLines((current) => current.filter((item) => item.id !== line.id))}
              />
            ))}
            <Pressable
              onPress={() => setLines((current) => [...current, newLine()])}
              accessibilityRole="button"
              accessibilityLabel="Добавить позицию"
              className="min-h-[48px] items-center justify-center rounded-xl active:opacity-60"
              style={{ borderWidth: 1, borderColor: t.separator, backgroundColor: t.surface }}
            >
              <Text className="text-[15px] font-semibold" style={{ color: t.accent }}>
                Добавить позицию
              </Text>
            </Pressable>
          </View>
        </SectionCard>

        <SectionCard title="Налог" padded>
          <SegmentedControl options={VAT_OPTIONS} value={vatMode} onChange={setVatMode} />
          {vatMode !== "off" ? (
            <View className="mt-4">
              <Field
                label="Ставка НДС, %"
                value={vatPercent}
                onChangeText={setVatPercent}
                keyboardType="decimal-pad"
                placeholder="19"
              />
            </View>
          ) : null}
          <View className="rounded-xl px-3 py-2" style={{ backgroundColor: t.canvas }}>
            <SummaryRow label="Без НДС" value={formatInvoiceMoney(totals.subtotal_net)} />
            {vatMode !== "off" ? (
              <SummaryRow label={`НДС ${Math.max(0, rate)}%`} value={formatInvoiceMoney(totals.vat_amount)} />
            ) : null}
            <SummaryRow label="Итого" value={formatInvoiceMoney(totals.total)} strong />
          </View>
        </SectionCard>

        <SectionCard title="Комментарий" padded>
          <Field
            label="Примечание для инвойса"
            value={notes}
            onChangeText={setNotes}
            placeholder="Условия оплаты или дополнительная информация"
            multiline
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
        </SectionCard>

        {error ? (
          <Text
            accessibilityRole="alert"
            className="mx-5 mt-3 text-center text-sm"
            style={{ color: t.danger }}
          >
            {error}
          </Text>
        ) : null}
        <View className="mx-4 mt-5">
          <Button
            label={`${initial ? "Сохранить" : "Выставить инвойс"} · ${formatInvoiceMoney(totals.total)}`}
            onPress={submit}
            loading={submitting}
            disabled={submitting}
          />
        </View>
      </ScrollView>

      <EntityPickerSheet
        visible={picker === "client"}
        title="Клиент"
        selectedId={clientId}
        options={clients.map((client) => ({ id: client.id, title: client.full_name, subtitle: client.phone }))}
        onPick={setClientId}
        onClose={() => setPicker(null)}
      />
      <EntityPickerSheet
        visible={picker === "appointment"}
        title="Заявка"
        selectedId={appointmentId}
        options={appointments
          .filter((item) => item.kind === "work" && item.status !== "cancelled")
          .map((item) => ({
            id: item.id,
            title: `${formatInvoiceDate(item.date)} · ${item.time_start}`,
            subtitle: `${clientById.get(item.client_id ?? "")?.full_name ?? "Без клиента"} · ${formatInvoiceMoney(item.total_amount)}`,
          }))}
        onPick={selectAppointment}
        onClose={() => setPicker(null)}
      />
      <EntityPickerSheet
        visible={picker === "team"}
        title="Команда"
        selectedId={teamId}
        options={teams.map((team) => ({ id: team.id, title: team.name, subtitle: team.region ?? undefined }))}
        onPick={setTeamId}
        onClose={() => setPicker(null)}
      />
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className={strong ? "text-base font-semibold" : "text-sm"} style={{ color: strong ? t.ink : t.sub }}>
        {label}
      </Text>
      <Text className={strong ? "text-lg font-bold tabular-nums" : "text-sm font-medium tabular-nums"} style={{ color: t.ink }}>
        {value}
      </Text>
    </View>
  );
}
