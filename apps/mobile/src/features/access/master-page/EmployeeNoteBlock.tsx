import { SectionCard } from "@/components/ui/SectionCard";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import type { Master } from "@/features/reference/queries";

import { useMasterProfileWrite } from "./use-profile-write";

// ЗАМЕТКА СОТРУДНИКА — сразу под блоком «Сотрудник», тем же полем, что
// заметка клиента под «Клиентом» (владелец 23.09 про клиента; 29.09 — тот же
// порядок у сотрудника). Подсказка называет поле. Пишет владелец.

const MAX_LEN = 500;

export function EmployeeNoteBlock({ card, readOnly = false }: { card: Master; readOnly?: boolean }) {
  const { profile, writeText } = useMasterProfileWrite(card);
  const saved = profile.note ?? "";
  const note = useInlineNote<null>(
    saved,
    null,
    (next) => writeText("note", next),
    card.id,
  );
  if (readOnly && !saved.trim()) return null;
  return (
    <SectionCard title="Заметка сотрудника">
      <InlineNoteField
        note={note}
        placeholder="Заметка сотрудника"
        accessibilityLabel="Заметка сотрудника"
        maxLength={MAX_LEN}
        readOnly={readOnly}
      />
    </SectionCard>
  );
}
