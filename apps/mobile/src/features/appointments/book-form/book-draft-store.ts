import type {
  AppointmentStatus,
  Discount,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { getStorage } from "@babun/shared/storage";
import { tenantPrefKey } from "@/lib/tenant-prefs";
import type { ServiceOverride } from "@/features/appointments/helpers";

// ЧЕРНОВИК НОВОЙ ЗАПИСИ ЖИВЁТ НА ТЕЛЕФОНЕ, А НЕ ТОЛЬКО В ПАМЯТИ ЭКРАНА.
// Звонок посреди записи, выгрузка приложения из памяти, обновление по
// воздуху — и всё набранное пропадало вместе с экраном. Поэтому каждое
// изменение новой записи ложится сюда (MMKV, ключ компании), а следующее
// «Создать запись» того же вида поднимает его обратно.
//
// Стирается черновик тремя дорогами, и только ими: запись создана;
// «Удалить черновик» в плашке «Черновик восстановлен»; «Не сохранять» на
// вопросе при выходе. Оплата, файлы и личное напоминание сюда не входят:
// деньги и снимки с телефона без человека перед глазами не повторяем.

const BASE = "book-draft";
/** Черновик старше суток уже не «прерванная запись», а забытая: поднимать
 *  его поверх нового тапа по календарю значило бы путать. */
export const BOOK_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface BookDraftSnapshot {
  v: 1;
  savedAt: number;
  kind: "work" | "event";
  teamId: string | null;
  clientId: string | null;
  locationId: string | null;
  address: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  durationTouched: boolean;
  durationByHand: boolean;
  serviceIds: string[];
  overrides: Record<string, ServiceOverride>;
  masterId: string | null;
  customTotal: boolean;
  totalDraft: string;
  discountType: Discount["type"] | null;
  discountValue: string;
  recordVatMode: TxVatMode;
  recordVatRate: number | null;
  status: AppointmentStatus;
  comment: string;
  eventTitle: string;
  eventColor: string | null;
  eventTypeId: string | null;
  eventNotes: string;
  eventAddress: string;
  eventUrl: string;
  eventReminderOffset: number | null;
  repeat: PersonalEventRepeat;
  allDay: boolean;
  reminderOn: boolean;
  colorOverride: string | null;
  city: string | null;
  cityTouched: boolean;
  /** Номер новой записи. Форму могут пересоздать посреди «Создать» (Android
   *  убил активность, обновление по воздуху): без номера поднятый черновик
   *  получал новый id, и второй тап заводил дубль уже вставшей записи. С
   *  номером повтор упирается в ту же запись — сервер считает это успехом. */
  newRecordId?: string;
}

const key = (tenantId: string) => tenantPrefKey(BASE, tenantId);

/** Черновик для нового «Создать …» этого вида, если он есть и свежий. */
export function readBookDraft(
  tenantId: string | null,
  kind: "work" | "event",
  now: number = Date.now(),
): BookDraftSnapshot | null {
  if (!tenantId) return null;
  try {
    const snap = getStorage().get<BookDraftSnapshot>(key(tenantId));
    if (!snap || snap.v !== 1 || snap.kind !== kind) return null;
    if (!(now - snap.savedAt < BOOK_DRAFT_TTL_MS)) return null;
    return snap;
  } catch {
    // MMKV открывается лениво и умеет бросить, пока Keychain заперт.
    return null;
  }
}

export function writeBookDraft(tenantId: string | null, snap: BookDraftSnapshot): void {
  if (!tenantId) return;
  try {
    getStorage().set(key(tenantId), snap);
  } catch {
    // см. `readBookDraft`
  }
}

export function clearBookDraft(tenantId: string | null): void {
  if (!tenantId) return;
  try {
    getStorage().remove(key(tenantId));
  } catch {
    // см. `readBookDraft`
  }
}

/** Параметры маршрута, с которыми восстановленный черновик проходит через
 *  умолчания новой записи: команда, клиент с объектом, день и час — его, а
 *  не тапа по календарю. Иначе выбор команды «по последней» и префилл
 *  клиента перезаписали бы поднятое. */
export function paramsWithDraft<P extends {
  teamId?: string;
  clientId?: string;
  locationId?: string;
  date?: string;
  time_start?: string;
}>(params: P, snap: BookDraftSnapshot | null): P {
  if (!snap) return params;
  return {
    ...params,
    teamId: snap.teamId ?? undefined,
    clientId: snap.clientId ?? undefined,
    locationId: snap.locationId ?? undefined,
    date: snap.date,
    time_start: snap.timeStart,
  };
}
