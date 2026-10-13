import type { Location } from "@babun/shared/local/clients";
import type { LocationRequest } from "@/features/clients/location-request-link";

// Shared constants of the booking form (`app/book/index.tsx`).

export const EMPTY_LOCATIONS: Location[] = [];
export const EMPTY_REQUESTS: LocationRequest[] = [];
/** Пауза перед первым листом цепочки: столько уезжает попап слота, из
 *  которого сюда пришли. Меньше — и лист подаётся поверх закрывающегося окна,
 *  то есть не появляется вовсе. */
export const CHAIN_START_MS = 420;

// У цифровой клавиатуры нет клавиши возврата — даём панель «Готово» (iOS).
export const KBD_ACCESSORY_ID = "bookKbdDone";
/** Сколько ждать, пока KAV ужмёт список под выезжающую клавиатуру: раньше
 *  докрутка «до конца» останавливается на старой, ещё полной высоте. */
export const KEYBOARD_SETTLE_MS = 300;
