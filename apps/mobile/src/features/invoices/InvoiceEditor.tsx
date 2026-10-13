import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { useToast } from "@/components/ui/Toast";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { localeInfo } from "@babun/shared/i18n/locales";
import { InvoiceBlocks } from "./InvoiceBlocks";
import { InvoicePreviewSheet } from "./InvoicePreviewSheet";
import { PaperLanguageSheet } from "./PaperLanguageSheet";
import { type EditableInvoiceLine, formatInvoiceMoney } from "@/lib/paper/format";
import { InvoiceEditorFooter } from "./invoice-editor/InvoiceEditorFooter";
import { invoiceReason } from "./invoice-editor/invoice-rules";
import type { InvoiceEditorProps } from "./invoice-editor/types";
import { useInvoiceDraft } from "./invoice-editor/use-invoice-draft";
import { useInvoicePaper } from "./invoice-editor/use-invoice-paper";

export type {
  InvoiceEditorProps,
  InvoiceEditorValue,
  InvoicePrefill,
} from "./invoice-editor/types";

export function InvoiceEditor({
  prefill,
  existing,
  vatForTeam,
  clients,
  appointments,
  services,
  generator,
  teams,
  businessToday,
  tenant,
  submitting,
  onSubmit,
  onDirtyChange,
}: InvoiceEditorProps) {
  const toast = useToast();
  const draft = useInvoiceDraft({
    prefill, existing, vatForTeam, appointments, services, generator, teams, businessToday,
  });
  const {
    language, setLanguage, languageOpen, setLanguageOpen, newLine, incomeAmount,
    issuedOn, dueOn, setDueOn, changeIssuedOn, clientId, locationId,
    setLocationId, clientRequisitesId, setClientRequisitesId, appointmentId,
    teamId, changeTeam, vatMode, setVatMode, rememberedRate, setRateOverride,
    vatTouched, notes, setNotes, lines, setLines, discountKind, setDiscountKind,
    discountValue, setDiscountValue, error, setError, companyId, setCompanyId,
    accountId, previewOpen, setPreviewOpen,
  } = draft;
  const paper = useInvoicePaper({ draft, clients, existing, tenant, businessToday, onDirtyChange });
  const {
    companies, owner, currency, changeClient, parsedLines, rate, discountAmount,
    withDiscount, totals, pickedCompany, issuedYear, series, paperDoc,
  } = paper;

  /** УБРАННУЮ ПОЗИЦИЮ ВОЗВРАЩАЮТ ОДНИМ ТАПОМ. Свайп по строке — движение
   *  быстрое, и промах пальца не должен стоить строки счёта: снимок списка
   *  уходит в тост, «Отменить» его возвращает. Восстанавливается ВЕСЬ список,
   *  а не одна строка: порядок позиций в документе — тоже данные. */
  const removeLine = (line: EditableInvoiceLine) => {
    const before = lines;
    setLines((current) => current.filter((item) => item.id !== line.id));
    toast(`«${line.title.trim() || "Позиция"}» убрана`, "info", {
      label: "Вернуть",
      onPress: () => setLines(before),
    });
  };

  const setLine = (next: EditableInvoiceLine) =>
    setLines((current) => current.map((line) => (line.id === next.id ? next : line)));

  const reason = invoiceReason({
    lines,
    parsedLines,
    total: totals.total,
    rate,
    incomeAmount,
    currency,
    owner,
    companiesLoaded: !!companies.data,
    pickedCompany,
    vatMode,
  });

  const submit = async () => {
    setError(null);
    // Кнопка погашена ровно по этой причине; guard остаётся на случай вызова
    // не с кнопки (ротор VoiceOver, будущий «повторить»).
    if (reason) {
      setError(reason.text);
      return;
    }
    try {
      await onSubmit({
        language,
        // ТО, ЧТО В ПРЕВЬЮ, И ВЫСТАВЛЯЕТСЯ (аудит 03.10). Пустой выбор сервер
        // понимал как «юрлицо команды», а команды хранят юрлицо, бывшее
        // основным в день миграции STORY-101: сделал владелец основным B и
        // скрыл A — превью показывало B и «INV-2026-0001», а выпуск шёл от
        // скрытого A его серией и реквизитами.
        company_id: owner ? (companyId ?? pickedCompany?.id ?? null) : null,
        account_id: accountId,
        issued_on: issuedOn,
        due_on: dueOn,
        client_id: clientId,
        location_id: locationId,
        client_requisites_id: clientRequisitesId,
        appointment_id: appointmentId,
        brigade_id: teamId,
        vat_mode: vatMode,
        vat_percent: rate,
        lines: withDiscount(parsedLines),
        notes: notes.trim() || null,
        link_to_tx_id: prefill?.transactionId ?? null,
      });
    } catch (submissionError) {
      // Отказ — текстом функции базы: переводим при показе.
      setError(tDynamic((submissionError as Error).message));
    }
  };

  const actionVerb = existing ? "Сохранить инвойс" : "Выставить инвойс";
  // Кнопка называет сумму: она и есть ответ на вопрос «на сколько документ».
  const actionLabel = `${actionVerb} · ${formatInvoiceMoney(totals.total, currency)}`;

  return (
    <>
      {/* ЛЕНТА КОМАНД СТОИТ ТАМ ЖЕ, ГДЕ ВЕЗДЕ В ПРОДУКТЕ: первой строкой под
          шапкой экрана, над всем остальным, и в ОБОИХ режимах — владелец
          2026-09-21: «выбор команды оставь на том же месте, где всегда…
          всегда он был зафиксирован в одном». Тот же `ScopeChips`, что в
          календаре и финансах: одна лента на продукт, выбрана ровно одна
          команда, размер и вид не свои.

          Команда решает три вещи сразу: чей прайс предлагать в услугах, чьи
          кассы показывать и по какому календарю лягут деньги. */}
      {/* ЛЕНТА КОМАНД — ВСЕГДА, даже когда команда одна (владелец
          2026-09-22: «сверху обязательно плашка с командой»): инвойс
          выставляется НА КОМАНДУ, и её видно до первого тапа. */}
      {teams.length > 0 ? (
        <ScopeChips
          items={teams.map((team) => ({
            id: team.id,
            name: team.name,
            color: team.color,
          }))}
          activeId={teamId}
          onSelect={changeTeam}
        />
      ) : null}
        <KeyboardLift style={{ flex: 1 }}>
          {/* ФОРМА СЧЁТА — БЛОКАМИ, КАК ЗАПИСЬ И ЧЕК. Сами блоки живут в
              `InvoiceBlocks.tsx`: реквизиты, даты, клиент, услуги с «Итого»,
              счёт и комментарий. Здесь остаётся только состояние документа и
              его действие — иначе этот файл рос бы дальше предела. */}
          <InvoiceBlocks
            clients={clients}
            clientId={clientId}
            onClientChange={changeClient}
            locationId={locationId}
            onLocationChange={setLocationId}
            clientRequisitesId={clientRequisitesId}
            onClientRequisitesChange={setClientRequisitesId}
            issuedOn={issuedOn}
            dueOn={dueOn}
            onIssuedOnChange={changeIssuedOn}
            onDueOnChange={setDueOn}
            companyId={companyId}
            onCompanyChange={setCompanyId}
            showRequisites={owner}
            companyLocked={!!existing}
            language={{ value: localeInfo(language).name, onPress: () => setLanguageOpen(true) }}
            number={
              !pickedCompany
                ? undefined
                : existing
                  ? {
                      companyId: pickedCompany.id,
                      year: existing.year,
                      next: { seq: existing.seq, number: existing.number, canSetStart: false },
                    }
                  : { companyId: pickedCompany.id, year: issuedYear, next: series.data ?? null }
            }
            teamId={teamId}
            lines={lines}
            currency={currency}
            services={services}
            onLineChange={setLine}
            onAddLine={(service) =>
              setLines((current) => [
                ...current,
                service
                  ? newLine(
                      service.name,
                      "1",
                      String(Number(service.price)),
                      service.description,
                      service.unit,
                      service.id,
                    )
                  : newLine(),
              ])
            }
            onAddCustomLine={() =>
              setLines((current) => [...current, newLine("", "1", "")])
            }
            onRemoveLine={removeLine}
            vatMode={vatMode}
            vatRate={Math.max(0, rate)}
            onVatModeChange={(next) => {
              vatTouched.current = true;
              setVatMode(next);
            }}
            discount={{
              kind: discountKind,
              value: discountValue,
              amount: discountAmount,
              onKindChange: setDiscountKind,
              onValueChange: setDiscountValue,
            }}
            onVatRateChange={(next) => {
              vatTouched.current = true;
              setRateOverride(next);
              rememberedRate.remember(next);
            }}
            totals={{ total: totals.total }}
            notes={notes}
            onNotesChange={setNotes}
            footer={
              <InvoiceEditorFooter
                error={error}
                reason={reason}
                actionLabel={actionLabel}
                submitting={submitting}
                onPreview={() => setPreviewOpen(true)}
              />
            }
          />
        </KeyboardLift>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={submitting}
        label={actionVerb}
        // Документ открывают и посмотреть: пока он не готов, кнопка выпуска
        // в листе погашена и говорит почему — выставить €0 мимо формы нельзя.
        blockedReason={reason?.text ?? null}
        // ОТКАЗ СЕРВЕРА — В ЛИСТЕ, ГДЕ НАЖАЛИ (аудит 03.10): текст ошибки
        // вставал в подвал формы ПОД листом, и «Выставить» просто мигало.
        error={error}
        // ЯЗЫК БУМАГИ ВЫБИРАЮТ ТАМ, ГДЕ БУМАГУ ВИДНО: в листе документа перед
        // выпуском (владелец 22.09 убрал миниатюру с формы).
        language={language}
        onChangeLanguage={setLanguage}
        onIssue={() => {
          void submit();
        }}
        onClose={() => setPreviewOpen(false)}
      />

      <PaperLanguageSheet
        visible={languageOpen}
        value={language}
        onChange={setLanguage}
        onClose={() => setLanguageOpen(false)}
      />


      {/* ЛИСТОВ ВЫБОРА ЗАЯВКИ И КОМАНДЫ ЗДЕСЬ БОЛЬШЕ НЕТ. Клиента выбирают в его блоке — тем
          же `ClientPickerSheet`, что в записи и чеке (и с «Создать клиента»
          внутри, чего у прежнего листа не было).

          ЗАЯВКУ И КОМАНДУ ФОРМА НЕ СПРАШИВАЕТ ВОВСЕ, и это решение, а не
          потеря. Счёт по конкретной работе выставляют ИЗ САМОЙ РАБОТЫ —
          оттуда заявка, клиент, команда и строки приезжают готовыми
          (`prefill` + `generateInvoiceFromAppointment`). Выбор заявки внутри
          формы был вторым путём к тому же и отвечал на вопрос, которого у
          человека, открывшего «Выставить инвойс» из «Финансов», нет: он
          выставляет счёт клиенту, а не подшивает его к заявке. */}
    </>
  );
}
