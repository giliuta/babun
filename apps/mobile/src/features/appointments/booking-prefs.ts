import type {
  RecordColorPalette,
  RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import { useEffect } from "react";
import { featureOfBookingBlock, isFeatureOn } from "@babun/shared/local/company-features";
import { getStorage } from "@babun/shared/storage";
import { useDataRole } from "@/features/settings/tenant";
import { useDisabledFeatures, useSetCompanyFeature } from "@/features/settings/company-features";
import { useTenantId } from "@/lib/tenant";
import { localBookingCarry } from "./booking-carry";
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

/** Включённые блоки формы записи, в порядке показа. */
export function useBookingBlocks(): BookingBlockId[] {
  const disabled = useDisabledFeatures();
  useCarryLocalBookingBlocks();
  return BOOKING_BLOCKS.filter((block) => {
    if (block.pinned) return true;
    const feature = featureOfBookingBlock(block.id);
    return feature === null || isFeatureOn(disabled, feature);
  }).map((block) => block.id);
}

/** Тумблер блока на странице «Блоки формы» — это тумблер функции компании. */
export function useToggleBookingBlock() {
  const disabled = useDisabledFeatures();
  const set = useSetCompanyFeature();
  return {
    ...set,
    mutate: (id: BookingBlockId) => {
      const feature = featureOfBookingBlock(id);
      if (!feature) return;
      set.mutate({ key: feature, on: !isFeatureOn(disabled, feature) });
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
// нейтральным сигналом «нет клиента».
const SITUATION_DEFAULTS: Record<ColorSituation, string> = {
  noClient: "#8E8E93",
  noObject: "#DF510F",
  noServices: "#FDAA1B",
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

export function useAutoColorRule(): AutoColorRule {
  return useCalendarSettings().data?.recordColorRule ?? "team";
}

export function useSituationPalette(): SituationPalette {
  return paletteWithDefaults(
    useCalendarSettings().data?.recordColorPalette,
  );
}

export function useFallbackColor(): string {
  return useCalendarSettings().data?.recordColorFallback ?? FALLBACK_DEFAULT;
}

export function useSetAutoColorRule() {
  const save = useSaveCalendarSettings();
  return {
    ...save,
    mutate: (rule: AutoColorRule) => save.mutate({ recordColorRule: rule }),
  };
}

export function useSetFallbackColor() {
  const save = useSaveCalendarSettings();
  return {
    ...save,
    mutate: (color: string) =>
      save.mutate({ recordColorFallback: color || undefined }),
  };
}

export function useSetSituationColor() {
  const settings = useCalendarSettings();
  const save = useSaveCalendarSettings();
  return {
    ...save,
    // Патч цвета ОДНОЙ ситуации переписывает палитру целиком: колонка одна,
    // и частичного слияния jsonb здесь нет. Основа — то, что сейчас на
    // экране (с заводскими), иначе первая же правка стёрла бы соседние.
    mutate: (input: { situation: ColorSituation; color: string | null }) => {
      const base = paletteWithDefaults(settings.data?.recordColorPalette);
      save.mutate({
        recordColorPalette: { ...base, [input.situation]: input.color },
      });
    },
  };
}
