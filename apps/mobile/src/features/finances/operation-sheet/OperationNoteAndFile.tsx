import { SectionCard } from "@/components/ui/SectionCard";
import { InlineNoteField } from "@/components/blocks/InlineNoteField";
import { OperationReceiptRow } from "../OperationReceiptRow";
import type { ReceiptSession } from "../receipt-upload";

/** The tail of the operation form: the note and the attached file. */
export function OperationNoteAndFile({
  notes,
  onNotesChange,
  showFile,
  receiptAsked,
  receiptUrl,
  onReceiptPick,
  fileDisabled,
  session,
}: {
  notes: string;
  onNotesChange: (next: string) => void;
  /** The receipts bucket is the owner's: nobody else gets the row. */
  showFile: boolean;
  /** The category asks for a receipt photo. */
  receiptAsked: boolean;
  receiptUrl: string | null;
  onReceiptPick: (path: string | null) => void;
  fileDisabled: boolean;
  session: ReceiptSession;
}) {
  return (
    <>
      {/* 6. ЗАМЕТКА. Подсказка НАЗЫВАЕТ поле, а не объясняет примером
          (владелец 2026-09-10 о заметке долга: «как объяснение не надо, это
          „например, обещал…“»). Разные подсказки по направлению ушли вместе
          с примером. */}
      <SectionCard title="Заметка" dense>
        <InlineNoteField
          note={{
            draft: notes,
            setDraft: onNotesChange,
            onFocus: () => {},
            onBlur: () => {},
          }}
          placeholder="Заметка операции"
          accessibilityLabel="Заметка операции"
          maxLength={500}
        />
      </SectionCard>

      {/* 7. ФАЙЛ — та же строка, что у долга и у файлов записи. Бакет чеков
          владельческий: у сотрудника выбор файла закончился бы отказом
          хранилища, поэтому строки у него нет вовсе. */}
      {showFile ? (
        <SectionCard title={receiptAsked ? "Фото чека" : "Файл"} dense>
          <OperationReceiptRow
            receiptUrl={receiptUrl}
            onPick={onReceiptPick}
            disabled={fileDisabled}
            session={session}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
