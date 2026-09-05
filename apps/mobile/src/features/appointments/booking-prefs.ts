import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";
import { createEnabledPrefs } from "@/lib/enabled-prefs";

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

export type BookingBlockId = "object" | "label" | "payment" | "note";

export interface BookingBlockDef {
  id: BookingBlockId;
  label: string;
  /** Что исчезнет с формы, если выключить. Показывается подписью строки. */
  hint: string;
}

export const BOOKING_BLOCKS: BookingBlockDef[] = [
  { id: "object", label: "Объект", hint: "куда ехать" },
  { id: "label", label: "Метка", hint: "город или район выезда" },
  { id: "payment", label: "Оплата", hint: "предоплата и долг" },
  { id: "note", label: "Заметка записи", hint: "что помнить об этой работе" },
];

const blocks = createEnabledPrefs<BookingBlockId>({
  storageKey: "babun-booking-blocks",
  queryKey: "booking-blocks",
  all: BOOKING_BLOCKS.map((b) => b.id),
  // По умолчанию включено всё: продукт не решает за бизнес, чего ему не надо.
  defaults: BOOKING_BLOCKS.map((b) => b.id),
});

/** Включённые блоки формы записи, в порядке показа. */
export const useBookingBlocks = blocks.use;
export const useBookingBlocksOrder = blocks.useOrder;
export const useToggleBookingBlock = blocks.useToggle;

// ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ (владелец 2026-09-05: «разберём
// полноценно автоматический режим — это надо придумать в настройках и
// зафиксировать»).
//
// «Автоматически» значит «не выбирали руками», и до сих пор оно молча
// означало цвет КОМАНДЫ. Для одной фирмы это правда — цвет говорит, чья
// бригада; для другой важнее, КУДА едут, и тогда день читается по меткам.
// Правило теперь называется вслух и живёт в одном месте: календарь и форма
// красят запись одинаково, потому что спрашивают его.

export type AutoColorRule = "team" | "label";

export const AUTO_COLOR_RULES: { id: AutoColorRule; label: string }[] = [
  { id: "team", label: "Цвет команды" },
  { id: "label", label: "Цвет метки" },
];

const RULE_KEY = "babun-booking-auto-color";
const ruleKey = (tenantId: string | null) =>
  tenantId ? `${RULE_KEY}:${tenantId}` : RULE_KEY;

function readRule(tenantId: string | null): AutoColorRule {
  try {
    const v = getStorage().get<string>(ruleKey(tenantId));
    return v === "label" ? "label" : "team";
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
