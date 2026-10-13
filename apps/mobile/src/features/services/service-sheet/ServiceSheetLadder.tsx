import { Keyboard } from "react-native";
import { ServiceLadder } from "@/features/services/ServiceLadder";
import { displayValue, draftValue } from "@/features/services/economics";
import { qtyOf, storeCost } from "./service-sheet-math";
import type { ServiceSheetState } from "./use-service-sheet";

/** The quantity · price · cost · time table of the form, wired to the draft. */
export function ServiceSheetLadder({ sheet }: { sheet: ServiceSheetState }) {
  const {
    ladderSteps,
    currencySymbol,
    priceEntry,
    costEntry,
    setPriceEntry,
    setCostEntry,
    openRow,
    setOpenRow,
    economics,
    updateEconomics,
    scrollRef,
    setPrice,
    setCost,
    setDuration,
    addTier,
  } = sheet;
  return (
    <ServiceLadder
      steps={ladderSteps}
      currencySymbol={currencySymbol}
      priceEntry={priceEntry}
      costEntry={costEntry}
      onPriceEntryChange={setPriceEntry}
      onCostEntryChange={setCostEntry}
      openTimeId={openRow}
      onOpenTime={(id) => {
        setOpenRow(id);
        // Клавиатура от поля цены закрывается: время выбирают барабаном, а
        // открытая клавиатура поднимала лист и сдвигала строку из-под пальца.
        if (id) Keyboard.dismiss();
        // Барабан раскрывается ПОД строкой. У ПОСЛЕДНЕЙ строки это самый
        // низ листа — за кнопкой «Создать», и лист сам доводит его до глаза.
        // У строки посередине он и так перед глазами: прокрутка в конец
        // уносила его вниз, и время выбиралось вслепую (владелец 11.10:
        // «когда выбираю время, оно проваливается вниз, а не остаётся на
        // месте — только если наперёд добавлены услуги»).
        const lastId = economics.tiers[economics.tiers.length - 1]?.id ?? "base";
        if (id && id === lastId) {
          requestAnimationFrame(() =>
            scrollRef.current?.scrollToEnd({ animated: true }),
          );
        }
      }}
      onQtyChange={(id, v) =>
        updateEconomics({
          ...economics,
          tiers: economics.tiers.map((x) => {
            if (x.id !== id) return x;
            // ЧИСЛО НА ЭКРАНЕ НЕ МЕНЯЕТСЯ ОТ ПРАВКИ КОЛИЧЕСТВА — в обоих
            // режимах (аудит шестерёнки 03.10). «За всё» держит сумму
            // строки (economics.test), а «за одну» держала её же — и цена
            // за штуку, на которую человек смотрит, молча менялась: 45 на
            // «от 2» после «от 10» становилась 9. В режиме «за одну»
            // держим цену за штуку.
            if (priceEntry !== "unit") return { ...x, minQuantity: v };
            const unit = displayValue(x.rowPrice, qtyOf(x.minQuantity), "unit");
            return {
              ...x,
              minQuantity: v,
              rowPrice: draftValue(unit, qtyOf(v), "unit"),
            };
          }),
        })
      }
      onPriceChange={(id, v) => {
        if (id === "base") return setPrice(v);
        updateEconomics({
          ...economics,
          tiers: economics.tiers.map((x) =>
            x.id === id
              ? { ...x, rowPrice: draftValue(v, qtyOf(x.minQuantity), priceEntry) }
              : x,
          ),
        });
      }}
      onCostChange={(id, v) => {
        if (id === "base") return setCost(v);
        updateEconomics({
          ...economics,
          tiers: economics.tiers.map((x) =>
            x.id === id
              ? { ...x, rowCost: storeCost(v, qtyOf(x.minQuantity), costEntry) }
              : x,
          ),
        });
      }}
      onDurationChange={(id, v) => {
        if (id === "base") return setDuration(v);
        updateEconomics({
          ...economics,
          tiers: economics.tiers.map((x) =>
            x.id === id ? { ...x, totalDuration: v } : x,
          ),
        });
      }}
      onAdd={addTier}
      onRemove={(id) =>
        updateEconomics({
          ...economics,
          tiers: economics.tiers.filter((x) => x.id !== id),
        })
      }
    />
  );
}
