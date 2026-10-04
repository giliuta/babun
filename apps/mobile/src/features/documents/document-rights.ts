import { accessGate, type AccessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";

// ПРАВО «ДОКУМЕНТЫ» ДЛЯ СТРАНИЦ ДОКУМЕНТОВ (владелец 04.10): «Скрыты» — их
// не видно вовсе; «Видит» — открывает и смотрит, но не отправляет;
// «Выставляет» — всё. Без команды — лучший уровень по его календарям: так
// решается, пускать ли вообще в раздел чеков.
export function useDocumentLevel(teamId?: string | null): AccessGate {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return accessGate({ role, map, blockKey: "finance.documents", scope: "calendar", teamId });
}
