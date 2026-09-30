/** Ключ своих членств человека. Компанию не называет — принадлежит человеку и
 *  переживает переход (`PERSON_SCOPED_QUERY_HEADS`). Лист без зависимостей:
 *  его зовёт выселение компании, которому нельзя тянуть экранные хуки. */
export const myMembershipsQueryKey = (userId: string | null) => ["my-memberships", userId] as const;
