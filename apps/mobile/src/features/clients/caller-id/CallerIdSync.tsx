import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMirror } from "@/session/mirror-state";
import { useClients } from "@/features/clients/queries";
import { buildCallerIdEntries, serializeCallerIdEntries } from "./caller-id-entries";
import { callerIdNative, isDisabledError } from "./caller-id-native";
import { CALLER_ID_STATUS_KEY, useCallerIdOn } from "./caller-id-store";

// БАЗА ОПРЕДЕЛИТЕЛЯ ИДЁТ ЗА КЛИЕНТАМИ. Список клиентов меняется — создали,
// поправили номер, удалили, пришло с другого телефона, — и через секунду
// файл в App Group переписывается, а iOS перезагружает расширение. Без
// интерфейса; живёт рядом с уведомлениями команды в `(dashboard)/_layout`.
//
// Выключили — файл пустеет, и телефон больше никого не подписывает.
// В ЗЕРКАЛЕ («его глазами») номера гасятся до того, что видит сотрудник:
// переписать базу по ним значило бы стереть владельцу подписи, поэтому на
// это время синхронизация стоит. Пока список грузится или не загрузился —
// тоже стоит: пустой ответ не повод стирать базу.

const SETTLE_MS = 1000;

// Перезагрузка не удалась, а файл уже новый — следующий проход повторит её,
// даже если список не изменился.
let reloadOwed = false;

export function CallerIdSync() {
  if (!callerIdNative) return null;
  return <CallerIdSyncRunner />;
}

function CallerIdSyncRunner() {
  const qc = useQueryClient();
  const on = useCallerIdOn().data;
  const clients = useClients();
  const mirror = useMirror();
  const loaded = clients.isSuccess ? clients.data : null;

  const desired = useMemo(() => {
    if (on === undefined) return null;
    if (!on) return "";
    if (mirror || !loaded) return null;
    return serializeCallerIdEntries(buildCallerIdEntries(loaded));
  }, [on, mirror, loaded]);

  useEffect(() => {
    const native = callerIdNative;
    if (!native || desired == null) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const changed = await native.writeList(desired);
          if (!changed && !reloadOwed) return;
          reloadOwed = true;
          await native.reload();
          reloadOwed = false;
        } catch (error) {
          // Выключено в Настройках iOS: включат — iOS сам прочитает файл.
          if (isDisabledError(error)) reloadOwed = false;
        } finally {
          void qc.invalidateQueries({ queryKey: CALLER_ID_STATUS_KEY });
        }
      })();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [desired, qc]);

  return null;
}
