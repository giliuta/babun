import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { devicePrefKey } from "@/lib/tenant-prefs";
import { callerIdNative, type CallerIdStatus } from "./caller-id-native";

// «Имя клиента при звонке» — настройка ТЕЛЕФОНА, а не команды: база номеров
// одна на iPhone, и включает её тот, кто держит телефон. Поэтому ключ общий
// на все компании (`devicePrefKey`) и в базу ничего не пишется.

const KEY = devicePrefKey("caller-id");
const ON_KEY = ["caller-id-on"] as const;
export const CALLER_ID_STATUS_KEY = ["caller-id-status"] as const;

function readOn(): boolean {
  try {
    return getStorage().get<boolean>(KEY) === true;
  } catch {
    // MMKV закрыт, пока Keychain заперт: выключено — безопасное умолчание.
    return false;
  }
}

export function useCallerIdOn() {
  return useQuery({ queryKey: ON_KEY, queryFn: readOn, staleTime: Infinity });
}

export function useSetCallerIdOn() {
  const qc = useQueryClient();
  return useMutation({
    // Запись локальная — без сети TanStack иначе поставил бы её на паузу.
    networkMode: "always",
    mutationFn: async (on: boolean) => {
      try {
        getStorage().set(KEY, on);
      } catch {
        // best-effort, как у остальных настроек телефона
      }
      return on;
    },
    onSuccess: (on) => qc.setQueryData(ON_KEY, on),
  });
}

/** Включено ли расширение в Настройках iOS. Меняется вне приложения, поэтому
 *  не кэшируется: focusManager перечитывает его при возвращении в Babun. */
export function useCallerIdStatus() {
  return useQuery({
    queryKey: CALLER_ID_STATUS_KEY,
    enabled: callerIdNative != null,
    staleTime: 0,
    queryFn: async (): Promise<CallerIdStatus> => {
      if (!callerIdNative) return "unavailable";
      try {
        return await callerIdNative.getStatus();
      } catch {
        return "unknown";
      }
    },
  });
}
