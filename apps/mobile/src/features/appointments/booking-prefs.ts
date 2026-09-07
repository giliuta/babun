import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";
import { createEnabledPrefs } from "@/lib/enabled-prefs";
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
// Настройка МЕСТНАЯ (MMKV) и по тенанту, как способы связи и карты: это
// привычка ЭТОГО телефона и ЭТОЙ фирмы, а мастер работает на две.

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
// подсказки просто ненужные»). Здесь лежало поле `hint` с текстами «куда
// ехать», «предоплата и долг» — оно не доезжало до экрана ни разу:
// `ToggleListScreen` подписи не рисует по прямому отказу владельца. Мёртвое
// поле опаснее пустого: следующий читатель поверит, что подпись где-то есть.
// ВСЕ БЛОКИ СТРАНИЦЫ, В ПОРЯДКЕ СТРАНИЦЫ (владелец 2026-09-06: «в настройках
// добавь блок команда, метка, время, клиент, объект, услуга, оплата, заметка,
// файл»). Команда, время, клиент и услуги закреплены: без них записи нет.
// «Файлы» закреплены тоже (владелец 2026-09-06: «мне нужен блок файла, чтоб
// он был всегда — страница создаётся, и он остаётся»): на устройстве, где
// список блоков сохранили раньше, чем блок появился, он молча стоял
// выключенным, и у новой записи файлов не было.
export const BOOKING_BLOCKS: BookingBlockDef[] = [
  { id: "team", label: "Команда", pinned: true },
  { id: "label", label: "Метка" },
  { id: "when", label: "Время", pinned: true },
  { id: "client", label: "Клиент", pinned: true },
  { id: "object", label: "Объект" },
  { id: "services", label: "Услуги", pinned: true },
  { id: "payment", label: "Оплата" },
  { id: "note", label: "Заметка" },
  { id: "files", label: "Файлы", pinned: true },
];

const blocks = createEnabledPrefs<BookingBlockId>({
  storageKey: "babun-booking-blocks",
  queryKey: "booking-blocks",
  all: BOOKING_BLOCKS.map((b) => b.id),
  // По умолчанию включено всё: продукт не решает за бизнес, чего ему не надо.
  defaults: BOOKING_BLOCKS.map((b) => b.id),
  pinned: BOOKING_BLOCKS.filter((b) => b.pinned).map((b) => b.id),
  // До 2026-09-06 набор знал только эти четыре; «Файлы» у старых устройств
  // иначе стартовали бы выключенными.
  legacyIds: ["object", "label", "payment", "note"],
});

/** Включённые блоки формы записи, в порядке показа. */
export const useBookingBlocks = blocks.use;
export const useToggleBookingBlock = blocks.useToggle;

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

export type AutoColorRule = "team" | "label" | "service";

export const AUTO_COLOR_RULES: { id: AutoColorRule; label: string }[] = [
  { id: "team", label: "Цвет команды" },
  { id: "label", label: "Цвет метки" },
  { id: "service", label: "Цвет услуги" },
];

const RULE_KEY = "babun-booking-auto-color";
const ruleKey = (tenantId: string | null) =>
  tenantId ? `${RULE_KEY}:${tenantId}` : RULE_KEY;

function readRule(tenantId: string | null): AutoColorRule {
  try {
    // БЕЛЫЙ СПИСОК, А НЕ СРАВНЕНИЕ С ОДНИМ ЗНАЧЕНИЕМ. Пока здесь стояло
    // `v === "label" ? "label" : "team"`, любое новое правило записывалось бы,
    // но читалось как «Цвет команды» — и дефект выглядел бы как «настройка не
    // сохраняется», причём только после перезапуска приложения.
    const v = getStorage().get<string>(ruleKey(tenantId));
    return AUTO_COLOR_RULES.some((r) => r.id === v)
      ? (v as AutoColorRule)
      : "team";
  } catch {
    return "team";
  }
}

export function useAutoColorRule(): AutoColorRule {
  const tenantId = useTenantId();
  const { data } = useQuery({
    queryKey: ["booking-auto-color", tenantId],
    queryFn: () => readRule(tenantId),
    // MMKV читается синхронно: цвет известен на первом же кадре, иначе шапка
    // мигала бы командным цветом поверх выбранного правила.
    initialData: () => readRule(tenantId),
    staleTime: Infinity,
  });
  return data;
}

export function useSetAutoColorRule() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<AutoColorRule, Error, AutoColorRule>({
    // Локальная запись не ждёт сети: в самолёте настройка тоже переключается.
    networkMode: "always",
    mutationFn: async (rule) => {
      try {
        getStorage().set(ruleKey(tenantId), rule);
      } catch {
        // Запись best-effort.
      }
      return rule;
    },
    onSuccess: (rule) =>
      qc.setQueryData(["booking-auto-color", tenantId], rule),
  });
}

// ЦВЕТОВАЯ ПАЛИТРА ЗАПИСИ — «ЧЕГО НЕ ХВАТАЕТ» (владелец 2026-09-05: «ещё один
// блок — цветовая палитра; если нет клиента, тогда цвет такой-то, тапаю, могу
// выбрать любой; если нет объекта — такой-то… чтобы человек один раз настроил,
// и всё»).
//
// Правило разрешения живёт в `record-color` под тестами; здесь только хранение
// выбранных цветов. Умолчания сочные и разные: серый — «даже неизвестно, кому
// едем», оранжевый — «неизвестно куда», жёлтый — «неизвестно что делаем».
// Дырам полагается бросаться в глаза, иначе сигнала нет.

const SITUATION_DEFAULTS: Record<ColorSituation, string> = {
  noClient: "#8E8E93",
  noObject: "#FF9500",
  noServices: "#FFCC00",
};

const PALETTE_KEY = "babun-booking-palette";
const paletteKey = (tenantId: string | null) =>
  tenantId ? `${PALETTE_KEY}:${tenantId}` : PALETTE_KEY;

export type SituationPalette = Record<ColorSituation, string | null>;

function readPalette(tenantId: string | null): SituationPalette {
  const out = { ...SITUATION_DEFAULTS } as SituationPalette;
  try {
    const raw = getStorage().get<Record<string, string | null>>(
      paletteKey(tenantId),
    );
    if (raw && typeof raw === "object") {
      for (const def of COLOR_SITUATIONS) {
        // `null` — «не красить»; отсутствие ключа — умолчание.
        if (def.id in raw) out[def.id] = raw[def.id] ?? null;
      }
    }
  } catch {
    // Хранилище ещё не поднялось — работаем на умолчаниях.
  }
  return out;
}

export function useSituationPalette(): SituationPalette {
  const tenantId = useTenantId();
  const { data } = useQuery({
    queryKey: ["booking-palette", tenantId],
    queryFn: () => readPalette(tenantId),
    initialData: () => readPalette(tenantId),
    staleTime: Infinity,
  });
  return data;
}

// ЗАПАСНОЙ ЦВЕТ — ПОСЛЕДНЯЯ СТУПЕНЬ ПРАВИЛА. Он виден редко: и команда, и
// метка получают цвет автоматом при создании, — но «ничего» на его месте
// означало бы блок без цвета, поэтому «Не красить» здесь запрещено.
// Умолчание — Сапфировый из палитры, а не кобальт продукта: кобальта в
// справочнике нет, строка настройки не смогла бы назвать его словом.
const FALLBACK_KEY = "babun-booking-fallback-color";
const fallbackKey = (tenantId: string | null) =>
  tenantId ? `${FALLBACK_KEY}:${tenantId}` : FALLBACK_KEY;
const FALLBACK_DEFAULT = "#005BD3";

function readFallback(tenantId: string | null): string {
  try {
    const v = getStorage().get<string>(fallbackKey(tenantId));
    return typeof v === "string" && v.trim() ? v : FALLBACK_DEFAULT;
  } catch {
    return FALLBACK_DEFAULT;
  }
}

export function useFallbackColor(): string {
  const tenantId = useTenantId();
  const { data } = useQuery({
    queryKey: ["booking-fallback-color", tenantId],
    queryFn: () => readFallback(tenantId),
    initialData: () => readFallback(tenantId),
    staleTime: Infinity,
  });
  return data;
}

export function useSetFallbackColor() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<string, Error, string>({
    networkMode: "always",
    mutationFn: async (color) => {
      try {
        getStorage().set(fallbackKey(tenantId), color);
      } catch {
        // Запись best-effort.
      }
      return color;
    },
    onSuccess: (color) =>
      qc.setQueryData(["booking-fallback-color", tenantId], color),
  });
}

export function useSetSituationColor() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<
    SituationPalette,
    Error,
    { situation: ColorSituation; color: string | null }
  >({
    networkMode: "always",
    mutationFn: async ({ situation, color }) => {
      const next = { ...readPalette(tenantId), [situation]: color };
      try {
        getStorage().set(paletteKey(tenantId), next);
      } catch {
        // Запись best-effort.
      }
      return next;
    },
    onSuccess: (next) => qc.setQueryData(["booking-palette", tenantId], next),
  });
}
