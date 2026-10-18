/**
 * Write payload for a money table whose `team_id` may be sent as NULL.
 *
 * The column is NOT NULL, so the generated types demand a string. A NULL is
 * still a valid request: the BEFORE INSERT OR UPDATE trigger `fill_money_team`
 * derives the team from the row's account, invoice, appointment or debt, and
 * rejects the row (23502) when it finds none.
 */
export type TeamFilledByTrigger<T> = Omit<T, "team_id"> & {
  team_id?: string | null;
};
