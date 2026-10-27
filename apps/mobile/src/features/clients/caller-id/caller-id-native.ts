import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

// Мост к `modules/caller-id` (Swift). Сборка без расширения — веб, Android,
// dev-клиент, собранный до плагина, — модуля не знает: тогда `callerIdNative`
// пуст, и строка настроек не показывается вовсе. Спрашивать надо саму сборку:
// пакет в JS есть всегда, а нативного кода в старом клиенте нет.

export type CallerIdStatus = "enabled" | "disabled" | "unknown" | "unavailable";

interface CallerIdModule {
  isConfigured(): boolean;
  /** `true` — файл изменился, базу iOS стоит перезагрузить. */
  writeList(text: string): Promise<boolean>;
  reload(): Promise<void>;
  getStatus(): Promise<CallerIdStatus>;
  openSettings(): Promise<void>;
}

function load(): CallerIdModule | null {
  if (Platform.OS !== "ios") return null;
  const native = requireOptionalNativeModule<CallerIdModule>("BabunCallerId");
  try {
    return native?.isConfigured() ? native : null;
  } catch {
    return null;
  }
}

export const callerIdNative = load();

/** Расширение выключено в Настройках iOS (`CXErrorCodeCallDirectoryManagerError
 *  .extensionDisabled`): это не поломка, а подсказка «включите». */
export function isDisabledError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_CALLER_ID_RELOAD_6";
}
