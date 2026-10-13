import type { Location } from "@babun/shared/local/clients";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { useInlineNote } from "@/features/appointments/use-inline-note";

/** МИНИ-ЗАМЕТКА ОБЪЕКТА — ТА ЖЕ ПЛАШКА, ЧТО У ЗАМЕТКИ ЗАПИСИ (владелец
 *  22.09: «в записи мы выбираем объект, и там снизу сразу заметка; сделай
 *  такую же у клиента — под каждым объектом своя»). Своим компонентом, а не
 *  в цикле: у каждой плашки свой черновик и своя запись по уходу с поля. */
export function ObjectNote({
  loc,
  ownerKey,
  onSave,
}: {
  loc: Location;
  ownerKey: string;
  onSave: (id: string, next: string) => void;
}) {
  const note = useInlineNote<string>(
    loc.note ?? "",
    loc.id,
    (next, id) => onSave(id, next),
    ownerKey,
  );
  // Без выноса (30.09): у сотрудника чужой компании меню «Скопировать» нет.
  const caps = useClientsCapabilities();
  return (
    <InlineNoteField
      note={note}
      placeholder="Заметка объекта"
      accessibilityLabel={`Заметка объекта ${loc.label || loc.address || ""}`.trim()}
      maxLength={500}
      noCopy={!caps.export}
    />
  );
}
