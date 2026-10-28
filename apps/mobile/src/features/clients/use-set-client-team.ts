import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { clientWriteRefusal } from "@babun/shared/db/repositories/clients";
import { supabase } from "@/lib/supabase";
import { clientKeys } from "@/lib/client-query-keys";

/** «СМЕНИТЬ КОМАНДУ» КЛИЕНТА — дверью сервера `set_client_team`: она сверяет
 *  компанию команды и право менять клиента. Записи остаются у своих команд
 *  (`records_stay_in_their_team`), переезжает только «чей он». */
export function useSetClientTeam() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { error } = await supabase.rpc("set_client_team", {
        p_client_id: id,
        p_team_id: teamId,
      });
      if (error) throw new Error(clientWriteRefusal(error) ?? error.message);
    },
    onSuccess: (_d, { id, teamId }) => {
      const move = (c: Client) => (c.id === id ? { ...c, team_id: teamId } : c);
      qc.setQueriesData<Client[]>({ queryKey: clientKeys.all() }, (list) =>
        Array.isArray(list) ? list.map(move) : list,
      );
      qc.setQueriesData<Client>({ queryKey: clientKeys.card(id) }, (row) =>
        row && typeof row === "object" && "id" in row ? move(row) : row,
      );
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.card(id) });
    },
    meta: { errorHandled: true }, // the card says the refusal itself
  });
}
