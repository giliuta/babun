import type {
  RecordColorPalette,
  RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import { useEffect } from "react";
import {
  featureOfBookingBlock,
  isFeatureOn,
} from "@babun/shared/local/company-features";
import { getStorage } from "@babun/shared/storage";
import { useDataRole } from "@/features/settings/tenant";
import { useDisabledFeatures, useSetCompanyFeature } from "@/features/settings/company-features";
import { useTenantId } from "@/lib/tenant";
import { localBookingCarry } from "./booking-carry";
import {
  useSaveTeamDesign,
  useTeamDesign,
  type TeamBlockKey,
  type TeamDesign,
} from "./team-design";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import {
  COLOR_SITUATIONS,
  type ColorSituation,
} from "@/features/appointments/record-color";

// КАК ВЫГЛЯДИТ ЗАПИСЬ У ЭТОГО БИЗНЕСА (владелец 2026-09-05: «давай сделаем
// страницу, назовём её „Запись“, и там можно будет полноценно редактировать
// цветовую гамму и включать те блоки, которые нужны: допустим, для бьюти-
// мастеров объект не нужен — мы вообще можем его убрать»).
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
// Настройка — КОМПАНИИ (с 24.09, STORY-088): см. `useBookingBlocks` ниже.

export type BookingBlockId =
  | "team"
  | "label"
  | "when"
  | "client"
  | "object"
  | "services"
  | "payment"
  | "note"
  | "files";

export interface BookingBlockDef {
  id: BookingBlockId;
  label: string;
  /** Без этого блока записи нет — в настройках стоит всегда включённым. */
  pinned?: boolean;
}

// ПОДПИСЕЙ У СТРОК НЕТ, И ПОЛЯ ПОД НИХ ТОЖЕ (владелец 2026-09-04: «эти
// подсказки просто ненужные»).
// ВСЕ БЛОКИ СТРАНИЦЫ, В ПОРЯДКЕ СТРАНИЦЫ (владелец 2026-09-06: «в настройках
// добавь блок команда, метка, время, клиент, объект, услуга, оплата, заметка,
// файл»). Команда, время, клиент и услуги закреплены: без них записи нет.
export const BOOKING_BLOCKS: BookingBlockDef[] = [
  { id: "team", label: "Команда", pinned: true },
  { id: "label", label: "Метка" },
  { id: "when", label: "Время", pinned: true },
  { id: "client", label: "Клиент", pinned: true },
  { id: "object", label: "Объект" },
  { id: "services", label: "Услуги", pinned: true },
  { id: "payment", label: "Оплата" },
  { id: "note", label: "Заметка" },
  { id: "files", label: "Файлы" },
];

// БЛОКИ ЗАПИСИ — ЭТО ФУНКЦИИ КОМПАНИИ (STORY-088, 24.09). Тумблеры «Метка»,
// «Объект», «Оплата», «Заметка», «Файлы» жили в ТЕЛЕФОНЕ (MMKV
// `babun-booking-blocks:<tenant>`): выключенный у владельца объект стоял у
// мастера и на втором телефоне. Теперь блок включён, когда включена его
// функция компании (`calendar_settings.disabled_features`), — у всех
// одинаково, и владелец выключает его один раз.
const LEGACY_KEY = "babun-booking-blocks";

/** Ключ блока записи в «Дизайне» команды. */
const RECORD_BLOCK_KEY: Partial<Record<BookingBlockId, TeamBlockKey>> = {
  label: "record_label",
  object: "record_object",
  payment: "record_payment",
  note: "record_note",
  files: "record_files",
};

/** Выключенные блоки «Дизайна» команды; без строки команды — выводятся из
 *  прежних функций компании (так переезд ничего не ломает). */
function useTeamBlocksOff(teamId: string | null | undefined): Set<TeamBlockKey> {
  const design = useTeamDesign(teamId);
  const disabled = useDisabledFeatures();
  if (design) return new Set(design.disabledBlocks);
  const off = new Set<TeamBlockKey>();
  for (const block of BOOKING_BLOCKS) {
    const feature = featureOfBookingBlock(block.id);
    const key = RECORD_BLOCK_KEY[block.id];
    if (feature && key && !isFeatureOn(disabled, feature)) off.add(key);
  }
  return off;
}

/** Выключенное — ключами функций компании, как их ждут `crewBlocks` и
 *  финансы дня: функции компании плюс блоки записи ЭТОЙ команды
 *  (record_object → objects). Одна правда на экран мастера и владельца. */
export function useRecordFeaturesOff(teamId: string | null | undefined): string[] {
  const off = useTeamBlocksOff(teamId);
  const disabled = useDisabledFeatures();
  const out = new Set<string>(disabled);
  if (off.has("record_label")) out.add("record_label");
  if (off.has("record_object")) out.add("objects");
  if (off.has("record_payment")) out.add("record_payment");
  if (off.has("record_note")) out.add("record_note");
  if (off.has("record_files")) out.add("record_files");
  return [...out];
}

/** Включённые блоки формы записи КОМАНДЫ, в порядке показа (владелец 24.09:
 *  «всё отдельно под каждую команду»). Объект — ещё и функция компании
 *  (объекты клиентов): выключены объекты у компании — блока нет нигде. */
export function useBookingBlocks(teamId: string | null | undefined): BookingBlockId[] {
  const off = useTeamBlocksOff(teamId);
  const disabled = useDisabledFeatures();
  useCarryLocalBookingBlocks();
  return BOOKING_BLOCKS.filter((block) => {
    if (block.pinned) return true;
    if (block.id === "object" && !isFeatureOn(disabled, "objects")) return false;
    const key = RECORD_BLOCK_KEY[block.id];
    return !key || !off.has(key);
  }).map((block) => block.id);
}

// ── БЛОКИ СОБЫТИЯ ──
// Свои, не общие с записью (владелец 24.09: «на странице дизайна — выбор
// блоков в записи, выбор блоков в событиях»; миграция 20260924230000). Время
// и команда закреплены: без них события нет. Тип — нет (владелец 24.09:
// «можно вообще без типа — событие останется как обычная запись с
// заметкой»). Порядок — как у записи, чтобы на странице «Дизайн» одинаковые
// блоки стояли напротив друг друга. Объект события включён, только когда у
// компании вообще есть объекты (`objects`).

export type EventBlockId =
  | "team"
  | "type"
  | "when"
  | "label"
  | "client"
  | "object"
  | "note"
  | "files";

export interface EventBlockDef {
  id: EventBlockId;
  label: string;
  pinned?: boolean;
}

export const EVENT_BLOCKS: EventBlockDef[] = [
  { id: "team", label: "Команда", pinned: true },
  { id: "label", label: "Метка" },
  { id: "when", label: "Время", pinned: true },
  { id: "client", label: "Клиент" },
  { id: "object", label: "Объект" },
  { id: "type", label: "Тип" },
  { id: "note", label: "Заметка" },
  { id: "files", label: "Файлы" },
];

const EVENT_BLOCK_KEY: Partial<Record<EventBlockId, TeamBlockKey>> = {
  label: "event_label",
  type: "event_type",
  client: "event_client",
  object: "event_object",
  note: "event_note",
  files: "event_files",
};

/** Включённые блоки формы события КОМАНДЫ, в порядке показа. */
export function useEventBlocks(teamId: string | null | undefined): EventBlockId[] {
  const off = useTeamBlocksOff(teamId);
  const disabled = useDisabledFeatures();
  return EVENT_BLOCKS.filter((block) => {
    if (block.pinned) return true;
    // Объекта события нет там, где у компании нет объектов вовсе.
    if (block.id === "object" && !isFeatureOn(disabled, "objects")) return false;
    const key = EVENT_BLOCK_KEY[block.id];
    return !key || !off.has(key);
  }).map((block) => block.id);
}

/** Текущий «Дизайн» команды целиком — основа для патча. Без строки —
 *  собирается из настроек компании. */
function useDesignBase(teamId: string | null | undefined): TeamDesign {
  const design = useTeamDesign(teamId);
  const off = useTeamBlocksOff(teamId);
  const settings = useCalendarSettings().data;
  return (
    design ?? {
      rule: settings?.recordColorRule ?? "team",
      palette: settings?.recordColorPalette ?? null,
      fallback: settings?.recordColorFallback ?? null,
      disabledBlocks: [...off],
    }
  );
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
      save.mutate({ teamId, next: { ...base, disabledBlocks: [...off] } });
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

// ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ (владелец 2026-09-05: «разберём
// полноценно автоматический режим — это надо придумать в настройках и
// зафиксировать»).
//
// «Автоматически» значит «не выбирали руками», и до сих пор оно молча
// означало цвет КОМАНДЫ. Для одной фирмы это правда — цвет говорит, чья
// бригада; для другой важнее, КУДА едут, и тогда день читается по меткам; а
// для третьей — ЧТО делают, и тогда день читается по услугам: цвет берёт
// первая услуга записи, та самая, что напечатана третьей строкой блока.
// Правило называется вслух и живёт в одном месте: календарь и форма красят
// запись одинаково, потому что спрашивают его.

export type AutoColorRule = RecordColorRule;

export const AUTO_COLOR_RULES: { id: AutoColorRule; label: string }[] = [
  { id: "team", label: "Цвет команды" },
  { id: "label", label: "Цвет метки" },
  { id: "service", label: "Цвет услуги" },
];

// ЦВЕТА ЗАПИСИ ЖИВУТ В КОМПАНИИ, А НЕ В ТЕЛЕФОНЕ (2026-09-12).
//
// Правило, палитра ситуаций и запасной цвет лежали в MMKV — по ключам
// `babun-booking-auto-color|palette|fallback-color:<tenant>`, без сервера
// вовсе. Стоило открыть приложение на двух симуляторах владельца — ОДИН
// аккаунт, ОДНА компания, ОДИН бандл — и записи оказались выкрашены
// по-разному. Из того же корня: переустановка стирала настройку, а
// приглашённый сотрудник получал заводские цвета вместо настроенных.
//
// Теперь это поля `calendar_settings` (мигация record_color_settings), и
// читаются они той же дверью, что остальные настройки компании:
// `useCalendarSettings` (сервер + офлайн-кэш + роль) и
// `useSaveCalendarSettings` (патч, только владелец). Своего кэша, своего
// ключа и своей мутации у цветов больше нет — второй двери к одной настройке
// не бывает.
//
// ЗАВОДСКИЕ ЗНАЧЕНИЯ ЗНАЕТ ЭКРАН, А НЕ ХРАНИЛИЩЕ. В базе `undefined` значит
// «владелец не выбирал»: только так «сбросить к заводскому» отличимо от
// «владелец выбрал ровно этот серый».

// ЗАВОДСКИЕ ЦВЕТА — ИЗ НАБОРА (2026-09-24). Прежние #FF9500 / #FFCC00 /
// #005BD3 в набор не входили: в настройке стояло «Свой · Свой · Свой», выбрать
// заводской заново было нельзя, а на плотном блоке оранжевый и жёлтый
// сходились в один янтарь. Морковный и Янтарный разведены по тону и после
// затемнения блока; серого в наборе нет намеренно, он остаётся заводским
// нейтральным сигналом. 25.09: «нет клиента» и «нет услуг» сняты, «не
// оплачено» — рубиновый из набора (деньги, которые должны).
const SITUATION_DEFAULTS: Record<ColorSituation, string> = {
  unpaid: "#E8145D",
  noObject: "#DF510F",
};

const FALLBACK_DEFAULT = "#3276FB";

export type SituationPalette = Record<ColorSituation, string | null>;

function paletteWithDefaults(
  stored: RecordColorPalette | undefined,
): SituationPalette {
  const out = { ...SITUATION_DEFAULTS } as SituationPalette;
  if (!stored) return out;
  for (const def of COLOR_SITUATIONS) {
    if (def.id in stored) out[def.id] = stored[def.id] ?? null;
  }
  return out;
}

export function useAutoColorRule(teamId: string | null | undefined): AutoColorRule {
  return useDesignBase(teamId).rule;
}

export function useSituationPalette(teamId: string | null | undefined): SituationPalette {
  return paletteWithDefaults(useDesignBase(teamId).palette ?? undefined);
}

export function useFallbackColor(teamId: string | null | undefined): string {
  return useDesignBase(teamId).fallback ?? FALLBACK_DEFAULT;
}

function useSaveDesign(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    save,
    base,
    patch: (p: Partial<TeamDesign>) => {
      if (!teamId) return;
      save.mutate({ teamId, next: { ...base, ...p } });
    },
  };
}

export function useSetAutoColorRule(teamId: string | null | undefined) {
  const { save, patch } = useSaveDesign(teamId);
  return { ...save, mutate: (rule: AutoColorRule) => patch({ rule }) };
}

export function useSetFallbackColor(teamId: string | null | undefined) {
  const { save, patch } = useSaveDesign(teamId);
  return { ...save, mutate: (color: string) => patch({ fallback: color || null }) };
}

export function useSetSituationColor(teamId: string | null | undefined) {
  const { save, base, patch } = useSaveDesign(teamId);
  return {
    ...save,
    // Патч цвета ОДНОЙ ситуации переписывает палитру целиком — основа то, что
    // на экране (с заводскими), иначе первая правка стёрла бы соседние.
    mutate: (input: { situation: ColorSituation; color: string | null }) => {
      const current = paletteWithDefaults(base.palette ?? undefined);
      patch({ palette: { ...current, [input.situation]: input.color } });
    },
  };
}
