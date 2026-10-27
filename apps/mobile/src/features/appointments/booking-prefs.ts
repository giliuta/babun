import { useEffect } from "react";
import { isFeatureOn } from "@babun/shared/local/company-features";
import { getStorage } from "@babun/shared/storage";
import { useDataRole } from "@/session/tenant";
import { useDisabledFeatures } from "@/features/settings/company-features";
import { useTenantId } from "@/lib/tenant";
import { localBookingCarry } from "./booking-carry";
import { orderMovable } from "./block-order";
import { useSaveTeamDesign, useTeamDesign, type TeamBlockKey } from "./team-design";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import {
  BOOKING_BLOCKS,
  EVENT_BLOCK_KEY,
  EVENT_BLOCKS,
  EVENT_MOVABLE,
  RECORD_BLOCK_KEY,
  RECORD_MOVABLE,
  orderForm,
  type BookingBlockId,
  type EventBlockId,
} from "./booking-prefs/blocks";
import { useDesignBase, useTeamBlocksOff } from "./booking-prefs/design-base";

// КАК ВЫГЛЯДИТ ЗАПИСЬ У ЭТОГО БИЗНЕСА: на странице «Запись» редактируется
// цветовая гамма и включаются нужные блоки (например, бьюти-мастерам объект
// не нужен — его можно убрать).
//
// Форма записи одна на продукт, а бизнесы разные: у клининга и кондиционеров
// работа привязана к ОБЪЕКТУ (вилла, квартира, офис), у мастера маникюра
// объекта нет вовсе — клиент приходит сам. Блок, который никогда не заполняют,
// не «просто пустой»: он занимает экран, спрашивает и заставляет прокручивать
// мимо себя каждый раз.
//
// ЧТО НЕЛЬЗЯ ВЫКЛЮЧИТЬ: клиент, время, команда, услуги с итогом. Без них
// запись перестаёт быть записью — это не настройка вкуса, а определение
// предмета.
//
// Настройка — КОМПАНИИ (STORY-088): см. `useBookingBlocks` ниже.

// The block catalogue, the design base and the record colours live in
// `./booking-prefs/`; this file stays the public entry.
export {
  BOOKING_BLOCKS,
  EVENT_BLOCKS,
  EVENT_MOVABLE,
  RECORD_MOVABLE,
  type BookingBlockDef,
  type BookingBlockId,
  type EventBlockDef,
  type EventBlockId,
} from "./booking-prefs/blocks";
export { useDesignBase } from "./booking-prefs/design-base";
export {
  AUTO_COLOR_RULES,
  CANCELLED_DEFAULT,
  PAID_DEFAULT,
  PREPAID_DEFAULT,
  SITUATION_DEFAULTS,
  useAutoColorRule,
  useFallbackColor,
  useSetAutoColorRule,
  useCancelledColor,
  usePaidColor,
  usePrepaidColor,
  useSetSituationColor,
  useRememberedColor,
  useSituationPalette,
  type AutoColorRule,
  type PaletteKey,
  type SituationPalette,
} from "./booking-prefs/color";

// БЛОКИ ЗАПИСИ — ЭТО ФУНКЦИИ КОМПАНИИ (STORY-088). Тумблеры «Метка», «Объект», «Оплата»,
// «Заметка», «Файлы» не хранятся в ТЕЛЕФОНЕ (MMKV): иначе выключенный у
// владельца объект стоял бы у мастера и на втором телефоне. Блок включён, когда включена его
// функция компании (`calendar_settings.disabled_features`), — у всех
// одинаково, и владелец выключает его один раз.
const LEGACY_KEY = "babun-booking-blocks";

/** Включённые блоки формы записи КОМАНДЫ, в порядке показа (у каждой команды свои). Объект — ещё и функция компании
 *  (объекты клиентов): выключены объекты у компании — блока нет нигде. */
export function useBookingBlocks(teamId: string | null | undefined): BookingBlockId[] {
  const off = useTeamBlocksOff(teamId);
  const disabled = useDisabledFeatures();
  const order = useTeamDesign(teamId)?.recordOrder;
  useCarryLocalBookingBlocks();
  const on = BOOKING_BLOCKS.filter((block) => {
    if (block.pinned) return true;
    if (block.id === "object" && !isFeatureOn(disabled, "objects")) return false;
    const key = RECORD_BLOCK_KEY[block.id];
    return !key || !off.has(key);
  }).map((block) => block.id);
  return orderForm(BOOKING_BLOCKS, RECORD_MOVABLE, order).filter((id) => on.includes(id));
}

/** Включённые блоки формы события КОМАНДЫ, в порядке показа. */
export function useEventBlocks(teamId: string | null | undefined): EventBlockId[] {
  const off = useTeamBlocksOff(teamId);
  const disabled = useDisabledFeatures();
  const order = useTeamDesign(teamId)?.eventOrder;
  const on = EVENT_BLOCKS.filter((block) => {
    if (block.pinned) return true;
    // Объекта события нет там, где у компании нет объектов вовсе, — и там,
    // где команда выключила «Объект» в блоках записи: страница «Записи»
    // показывает его у события запертым, а форма события всё равно его
    // рисовала бы.
    if (block.id === "object" && (!isFeatureOn(disabled, "objects") || off.has("record_object")))
      return false;
    const key = EVENT_BLOCK_KEY[block.id];
    return !key || !off.has(key);
  }).map((block) => block.id);
  return orderForm(EVENT_BLOCKS, EVENT_MOVABLE, order).filter((id) => on.includes(id));
}

function useToggleTeamBlock(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    ...save,
    mutate: (key: TeamBlockKey | undefined) => {
      if (!teamId || !key) return;
      const off = new Set(base.disabledBlocks);
      if (off.has(key)) off.delete(key);
      else off.add(key);
      save.mutate({ teamId, base, next: { ...base, disabledBlocks: [...off] } });
    },
  };
}

/** Тумблер блока события команды («Дизайн» → «Блоки», колонка «Событие»). */
export function useToggleEventBlock(teamId: string | null | undefined) {
  const t = useToggleTeamBlock(teamId);
  return { ...t, mutate: (id: EventBlockId) => t.mutate(EVENT_BLOCK_KEY[id]) };
}

/** Тумблер блока записи команды («Дизайн» → «Блоки», колонка «Клиент»). */
export function useToggleBookingBlock(teamId: string | null | undefined) {
  const t = useToggleTeamBlock(teamId);
  return { ...t, mutate: (id: BookingBlockId) => t.mutate(RECORD_BLOCK_KEY[id]) };
}

/** Порядок подвижных блоков записи команды (перетаскивание в «Записях»). */
export function useRecordBlockOrder(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    ...save,
    order: orderMovable(RECORD_MOVABLE, base.recordOrder),
    mutate: (ids: string[], opts?: { onError?: (e: Error) => void }) => {
      if (!teamId) return;
      save.mutate({ teamId, base, next: { ...base, recordOrder: ids } }, opts);
    },
  };
}

/** Порядок подвижных блоков события команды. */
export function useEventBlockOrder(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    ...save,
    order: orderMovable(EVENT_MOVABLE, base.eventOrder),
    mutate: (ids: string[], opts?: { onError?: (e: Error) => void }) => {
      if (!teamId) return;
      save.mutate({ teamId, base, next: { ...base, eventOrder: ids } }, opts);
    },
  };
}

/** ПЕРЕНОС С ТЕЛЕФОНА — ОДИН РАЗ. У владельца, который уже выключил блоки на
 *  своём телефоне, они не должны молча вернуться: если в компании ещё ничего
 *  не выключено, а в телефоне выключено — переносим и забываем телефон. */
let carried = false;
function useCarryLocalBookingBlocks() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const settings = useCalendarSettings();
  const set = useSaveCalendarSettings();
  useEffect(() => {
    if (carried || role !== "owner" || !tenantId || !settings.isSuccess) return;
    carried = true;
    const plan = localBookingCarry(
      readLocal(`${LEGACY_KEY}:${tenantId}`),
      settings.data?.disabledFeatures ?? [],
      BOOKING_BLOCKS,
    );
    if (plan) set.mutate({ disabledFeatures: plan });
    clearLocal(tenantId);
    // Одноразовый перенос: зависимость от `set` лишняя и перезапускала бы его.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, tenantId, settings.isSuccess]);
}

function readLocal(key: string): string[] | undefined {
  try {
    const raw = getStorage().get<string[]>(key);
    return Array.isArray(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function clearLocal(tenantId: string) {
  try {
    const storage = getStorage();
    for (const suffix of ["", ":order", ":known"]) storage.remove(`${LEGACY_KEY}:${tenantId}${suffix}`);
  } catch {
    // Кэш телефона — не данные компании: не стёрся — не беда.
  }
}
