import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient as repoCreateClient } from "@babun/shared/db/repositories/clients";
import { createClient as createClientCached } from "@babun/shared/sync/clientsCached";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { isOnline, randomUuid } from "@babun/shared/sync";
import { OnlineOnlyWriteError } from "@babun/shared/sync/cache-errors";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { preflightQuotaForCreate } from "@/lib/quota";
import { isConfirmedNetworkUnavailable } from "@/lib/server-read-fallback";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { offlineForeignWriteMessage } from "@/session/clients-company";
import { clientKeys } from "@/lib/client-query-keys";
import { useQueryScope, writeClientOf } from "./scope";

export function useCreateClient() {
  const scope = useQueryScope();
  const tenantId = scope.tenantId;
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (overrides: Partial<Client>) => {
      if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
      if (scope.kind === "record") {
        throw new Error("Заводить клиентов этой компании может её владелец.");
      }
      if (scope.kind === "member" && !isOnline()) {
        throw new OnlineOnlyWriteError(offlineForeignWriteMessage(scope.tenantName));
      }
      await preflightQuotaForCreate(writeClientOf(scope), tenantId, "clients", {
        online: isOnline(),
        isNetworkUnavailable: (error) =>
          isConfirmedNetworkUnavailable(
            error && typeof error === "object"
              ? (error as { code?: string; message?: string; details?: string })
              : { message: String(error) },
          ),
      });
      // Offline-aware: wrapper writes the optimistic row to sqlite and either
      // hits the repo (online) or enqueues an insert op (offline), returning
      // the client-generated UUID either way.
      //
      // RN UUID guard: createBlankClient falls back to a NON-uuid `cli-…` id
      // when `crypto.randomUUID` is absent — which is EXACTLY the RN/Hermes
      // case (react-native-get-random-values only polyfills getRandomValues).
      // The wrapper keeps a supplied id verbatim (`id = input.id || …`), so a
      // `cli-…` id would flow into the offline queue and the replayer would
      // permanently-fail its update op (non-uuid row_id). Stamp a real RN-safe
      // UUID up front so the whole create→edit→replay chain stays consistent.
      const blank = createBlankClient(overrides);
      const fresh = { ...blank, id: randomUuid() };
      // Клиент работодателя заводится прямо на сервере его компании: очередь и
      // копия на диске — хозяйство своей базы.
      if (scope.kind === "member") {
        return repoCreateClient(tenantBoundClient(tenantId), fresh, tenantId);
      }
      return createClientCached(
        writeClientOf(scope),
        fresh,
        tenantId,
        scope.writeOpts,
      );
    },
    // ПЕРЕЧИТКУ НЕ ЖДЁМ. Обещание из `onSuccess` держит `mutateAsync`, пока
    // не перечитаются ВСЕ списки клиентов, — кнопка «Создать клиента» стояла
    // серой 10+ секунд, и повторный тап заводил дубль. Строка уже лежит в
    // кэше на диске, списки догонят сами.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
