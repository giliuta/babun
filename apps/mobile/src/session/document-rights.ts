import { accessGate, type AccessGate } from "@/session/my-access";
import { useMyAccess } from "@/session/access-queries";
import { useCurrentRole } from "@/session/tenant";

// ПРАВО «ДОКУМЕНТЫ» ДЛЯ СТРАНИЦ ДОКУМЕНТОВ: «Скрыты» — их
// не видно вовсе; «Видит» — открывает и смотрит, но не отправляет;
// «Выставляет» — всё. Без команды — лучший уровень по его календарям: так
// решается, пускать ли вообще в раздел чеков.
export function useDocumentLevel(teamId?: string | null): AccessGate {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return accessGate({ role, map, blockKey: "finance.documents", scope: "calendar", teamId });
}

// «МЕНЯЕТ» — ВЕСЬ БЛОК: партнёр с
// «Документы: Видит и меняет» в команде документа принимает оплату, правит,
// выписывает чек и кредит-ноту, возвращает и удаляет — как сервер
// (`_documents_write_*`). Для списков, где у каждой строки своя команда.
// Документ без команды — только владельцу: сервер решает так же.
export function useDocumentWriter(): (teamId: string | null | undefined) => boolean {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return (teamId) =>
    role === "owner" ||
    map?.isOwner === true ||
    (!!teamId &&
      accessGate({ role, map, blockKey: "finance.documents", scope: "calendar", teamId }) === "write");
}
