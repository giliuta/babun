import { accessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";

// СТУПЕНЬ СТРАНИЦЫ ИЗ «НАСТРОЕК КОМАНДЫ» (владелец 30.09: «Записи», «Услуги»,
// «Метки» — «Скрыт · Только видит · Видит и меняет»). Дверь в шестерёнке
// открыта и на «Только видит», поэтому страница сама читает, может ли этот
// человек править. Владелец — всегда `write`. Пока роль или карта прав не
// пришли — `read`: страница показывает данные, но не даёт правку, которую
// сервер мог бы отбить.
//
// Это только вид. Правку пускает сервер — политикой или дверью по праву той
// же строки.

export type TeamSettingLevel = "hidden" | "read" | "write";

export function useTeamSettingLevel(blockKey: string, teamId: string | null | undefined): TeamSettingLevel {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  // Права по блокам — у сотрудника; остальным ролям эти страницы, как и
  // раньше, закрыты (им отвечает `manage-calendar-settings`).
  if (role != null && role !== "owner" && role !== "master") return "hidden";
  const gate = accessGate({ role, map, blockKey, scope: "calendar", teamId: teamId ?? null });
  if (gate === "write") return "write";
  if (gate === "locked" || gate === "gone") return "hidden";
  return "read";
}
