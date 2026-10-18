import {
  clientsQueryKey,
  clientTagsQueryKey,
  sourceClientQueryKey,
  sourceClientsQueryKey,
  sourceClientTagsQueryKey,
} from "@/lib/company-query-keys";

// Query keys of the clients feature, one module for readers and writers.
//
// Full keys that tenant prefetch warms live in `lib/company-query-keys.ts` and
// are reused here, not redefined. The rest are the PREFIX keys writes
// invalidate by plus feature-local full keys. react-query matches prefixes
// element by element, so every shape is pinned literally in
// `query-keys.test.ts`: a renamed head would silently stop refreshing screens.
//
// The full «people of a card» key (`clientMembersQueryKey`) stays inside the
// pure core of `use-link-writer.ts`: that core is loaded standalone by a test
// and cannot import.
export const clientKeys = {
  /** Every clients list, any company and view. */
  all: () => ["clients"] as const,
  list: clientsQueryKey,
  sourceList: sourceClientsQueryKey,

  /** Every client card, any client. */
  cardAll: () => ["client"] as const,
  /** Every card of one client, any company and view. */
  card: (id: string) => ["client", id] as const,
  sourceCard: sourceClientQueryKey,

  /** Every tag directory. */
  tagAll: () => ["client-tags"] as const,
  tags: clientTagsQueryKey,
  sourceTags: sourceClientTagsQueryKey,

  /** Every «people» list of every card. */
  memberAll: () => ["client-members"] as const,
  /** Every «people» list of one company. */
  membersOfTenant: (tenantId: string | null) => ["client-members", tenantId] as const,

  /** Every attachments list. */
  attachmentAll: () => ["client-attachments"] as const,
  attachments: (tenantId: string | null, clientId: string) =>
    ["client-attachments", tenantId, clientId] as const,

  /** Every «deleted clients» shelf. */
  trashedAll: () => ["trashed-clients"] as const,
  trashed: (tenantId: string | null, view: string) =>
    ["trashed-clients", tenantId, view] as const,
};
