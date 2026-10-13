// Clients data layer — public surface. The hooks live in `./queries/` by
// concern; importers keep using this path.

/** Ключи живут в `lib/company-query-keys.ts`; реэкспорт для тех, кто уже
 *  импортирует их отсюда (`label-auto-assign`). */
export { clientsQueryKey, clientTagsQueryKey } from "@/lib/company-query-keys";

export { useClientCardWritable, useClientsSourceScope } from "./queries/scope";
export {
  listMasterClientsSafe,
  listMemberClients,
  memberClientContacts,
  memberClientJsonToClient,
} from "./queries/member-reads";
export { useClients } from "./queries/list";
export { useClient } from "./queries/card";
export {
  useSetClientTeam,
  useUpdateClient,
  useUpdateClientById,
  type ClientWriteTarget,
} from "./queries/mutations-update";
export { useCreateClient } from "./queries/mutations-create";
export {
  useArchiveClients,
  useDeleteClientForever,
  useRestoreClient,
  useTrashClientAsPartner,
  useTrashedClients,
  type ArchiveClientsInput,
  type ArchiveClientsResult,
} from "./queries/archive-trash";
export {
  useClientTags,
  useCreateClientTag,
  useDeleteClientTag,
  useReorderClientTags,
  useSetClientTagHidden,
  useUpdateClientTag,
  type CreateClientTagInput,
  type UpdateClientTagInput,
} from "./queries/tags";
