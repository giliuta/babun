import { useEffect, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { moneySymbol } from "@babun/shared/common/utils/money";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import type { LadderStep } from "@/features/services/ServiceLadder";
import { useTenant } from "@/session/tenant";
import { type Service, type ServiceInput } from "@/features/services/queries";
import { roundToStep } from "@/lib/service-format";
import {
  displayValue,
  createTierDraft,
  validateServiceEconomics,
  type ServiceEconomicsDraft,
} from "@/features/services/economics";
import { baseFieldErrors, firstServiceError, qtyOf, showCost } from "./service-sheet-math";
import { useServiceFields } from "./use-service-fields";
import type { ServiceEditing } from "../ServiceSheet";

export type ServiceSheetProps = {
  editing: ServiceEditing | null;
  /** Готовые услуги других команд аккаунта — шаблоны новой услуги
   *  (значок справа в шапке листа, только при создании). */
  templates?: readonly { service: Service; teamName: string }[];
  /** Per-team-контекст: новая услуга сразу привязана к этой команде. */
  lockedTeamId?: string;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ServiceInput, serviceId?: string) => void;
};

/** State and actions of the service form sheet. */
export function useServiceSheet({ editing, lockedTeamId, busy, onClose, onSave, templates }: ServiceSheetProps) {
  // ЗНАК ВАЛЮТЫ — ИЗ ТЕНАНТА, а не зашитый «€»: у компании в другой валюте
  // прайс печатался бы в чужой.
  const currencySymbol = moneySymbol(useTenant().data?.currency);
  const service = editing?.mode === "edit" ? editing.service : null;
  /** Источник дубля: лист открыт на СОЗДАНИЕ, но поля засеяны чужими. */
  const source = editing?.mode === "create" ? editing.from : undefined;

  const fields = useServiceFields();
  const {
    name, color, icon, price, duration, cost, description, hasDescription,
    priceEntry, costEntry, weekdays, hasWeekdays, bufferAfter, hasBufferAfter,
    economics, setEconomics, economicsErrors, setEconomicsErrors,
    setBaseErrors, setOpenRow, seedFields,
  } = fields;
  const [seeded, setSeeded] = useState<ServiceEditing | null>(null);
  // ШАБЛОНЫ ВНУТРИ ЛИСТА (владелец 11.10: «значок в самой шторке справа:
  // нажимаю шаблон — в этой же шторке появляется вся услуга, и я продолжаю
  // её редактировать»). Список готовых услуг рисуется вместо формы в ЭТОМ
  // листе — второе окно поверх листа iOS не показывает (так и «залагало»).
  const [picking, setPicking] = useState(false);
  const [template, setTemplate] = useState<Service | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (editing !== seeded) {
    // Новый показ листа — засеять поля (render-time reset).
    setSeeded(editing);
    setPicking(false);
    setTemplate(null);
    seedFields(
      service ?? source ?? null,
      service
        ? service.name
        : source
          ? editing?.mode === "create" && editing.copy
            ? source.name
            : `${source.name} копия`
          : "",
    );
  }

  // Владелец услуги — команда, чей прайс открыт. Спрашивать её в форме
  // незачем: человек уже стоит в её списке.
  //
  // У КОПИИ ИЗ ЧУЖОЙ КОМАНДЫ ВЛАДЕЛЕЦ — ТА, КУДА КОПИРУЮТ. Команда источника
  // здесь перебивала открытый прайс, и «взять готовую» молча заводило вторую
  // услугу в ЧУЖОЙ команде: человек копировал в Команду 1, а услуга уезжала
  // обратно в Команду 2. У дубля внутри команды источник верен — он и есть
  // эта команда.
  const isForeignCopy = editing?.mode === "create" && !!editing.copy;
  const ownerTeam =
    service?.team_id ??
    (isForeignCopy ? lockedTeamId : source?.team_id ?? lockedTeamId) ??
    null;
  const canSubmit = name.trim().length > 0 && !!ownerTeam && !busy;

  // ТАП ПО ФОНУ НЕ ВЫБРАСЫВАЕТ НАБРАННУЮ УСЛУГУ (аудит 2026-10-03): цена,
  // лестница и описание пропадали молча — следующее открытие засевает лист
  // заново. Снимок полей — сразу после засева (эффектов, которые правят
  // поля после него, у листа нет).
  const signature = JSON.stringify([
    name, color, icon, price, duration, cost, description, hasDescription,
    priceEntry, weekdays, hasWeekdays, bufferAfter, hasBufferAfter, economics,
  ]);
  const seededSignature = useRef<string | null>(null);
  useEffect(() => {
    seededSignature.current = editing ? signature : null;
    // Только на новый показ листа: снимок — «как открыли».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);
  const guard = useGuardedClose({
    dirty: seededSignature.current != null && signature !== seededSignature.current,
    busy,
    onClose,
    message: "Набранное в услуге не сохранится.",
  });

  const updateEconomics = (next: ServiceEconomicsDraft) => {
    setEconomics(next);
    if (economicsErrors) {
      setEconomicsErrors(validateServiceEconomics(next).errors);
    }
  };

  const bufferAfterMin = Math.max(0, Number(bufferAfter) || 0);

  // ЛЕСЕНКА ОДНИМ СПИСКОМ: базовая строка (количество 1) плюс ступени.
  // Четыре блока рисуют ОДИН И ТОТ ЖЕ список — иначе они разъехались бы по
  // столбцам, и цена оказалась бы у количества, которого нет.
  // Направления пересчёта цены и расхода — `service-sheet-math.ts`.
  const ladderSteps: LadderStep[] = [
    {
      tier: null,
      qty: "1",
      price,
      cost,
      duration,
    },
    ...economics.tiers.map((tier) => {
      const q = qtyOf(tier.minQuantity);
      return {
        tier,
        qty: tier.minQuantity,
        price: displayValue(tier.rowPrice, q, priceEntry),
        cost: showCost(tier.rowCost, q, costEntry),
        duration: tier.totalDuration,
      };
    }),
  ];

  const submit = () => {
    const parsedPrice = Number(price.trim().replace(",", "."));
    const parsedDuration = Number(duration.trim());
    const nextBaseErrors = baseFieldErrors(price, duration);
    const validated = validateServiceEconomics(economics);
    setBaseErrors(nextBaseErrors);
    setEconomicsErrors(validated.errors);
    if (Object.keys(nextBaseErrors).length > 0 || !validated.value) return;

    // СНЯТОЕ ОПИСАНИЕ — ТОЖЕ ЗАПИСЬ, А НЕ МОЛЧАНИЕ: обновление услуги шлёт
    // ЧАСТИЧНЫЙ патч, и без явного `null` стёртый текст остался бы в базе.
    onSave(
      {
        name: name.trim(),
        team_id: ownerTeam as string,
        ...(color ? { color } : {}),
        icon,
        description: description.trim() || null,
        cost_per_unit: Math.max(0, Number(cost.trim().replace(",", ".")) || 0),
        price: parsedPrice,
        duration_minutes: parsedDuration,
        // Уезжают ВСЕГДА, а не по «если заполнено»: снятая единица обязана
        // писаться явным `null`, снятые дни — явным пустым массивом.
        price_entry: priceEntry,
        available_weekdays: weekdays,
        ...(editing?.mode === "create" && editing.copy && source
          ? { copied_from_service_id: source.id }
          : template
            ? { copied_from_service_id: template.id }
            : {}),
        buffer_after_min: Math.max(0, Number(bufferAfter) || 0),
        ...validated.value,
      },
      service?.id,
    );
  };

  const addTier = () => {
    const number = (raw: string) => {
      const parsed = Number(raw.trim().replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    // Количество и время приезжают заполненными, цена — пустой: см.
    // `createTierDraft`. Зерно времени клампится к потолку барабана ВИДИМО:
    // показано — значит сказано, молчаливого исправления нет.
    // Новая строка наследует расход строки выше: у материалов на единицу от
    // количества скидки нет — та же химия на ту же штуку.
    // Расход наследуется ЗА ОДНУ и подставляется за всё — пересчёт живёт в
    // `createTierDraft`, которому для этого достаточно первой строки: у неё
    // количество 1, значит её расход и есть расход на единицу.
    const tier = createTierDraft(economics.tiers, number(duration), cost);
    const seeded = {
      ...tier,
      totalDuration: String(roundToStep(Number(tier.totalDuration))),
    };
    updateEconomics({ ...economics, tiers: [...economics.tiers, seeded] });
    setOpenRow(null);
    // Строка приезжает вниз — лист обязан САМ довести её до глаза, иначе
    // «＋ Количество» снаружи выглядит не сделавшей ничего.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  };

  const firstError = firstServiceError(fields.baseErrors, economicsErrors);

  const canPickTemplate = !service && (templates?.length ?? 0) > 0;
  const applyTemplate = (from: Service) => {
    // Имя — как у шаблона: в этой команде это не копия, а своя услуга.
    seedFields(from, from.name);
    setTemplate(from);
    setPicking(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  return {
    ...fields,
    currencySymbol,
    service,
    picking,
    setPicking,
    scrollRef,
    canSubmit,
    guard,
    updateEconomics,
    bufferAfterMin,
    ladderSteps,
    submit,
    addTier,
    firstError,
    canPickTemplate,
    applyTemplate,
  };
}

export type ServiceSheetState = ReturnType<typeof useServiceSheet>;
