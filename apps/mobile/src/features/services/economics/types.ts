// Service economics shapes: stored tier values, the editor draft and errors.

export type PriceTierValue = {
  min_qty: number;
  price_per_unit: number;
};

export type DurationTierValue = {
  min_qty: number;
  duration_minutes: number;
};

export interface ServiceTierDraft {
  id: string;
  minQuantity: string;
  rowPrice: string;
  /** Расход за одну на этом количестве. Пустым не бывает: очищенный
   *  схлопывается в «0» — расход не доходит до клиента, он живёт только в
   *  прибыли, поэтому здесь пусто МОЖНО читать как ноль (у цены нельзя). */
  rowCost: string;
  totalDuration: string;
}

export interface ServiceEconomicsDraft {
  tiers: ServiceTierDraft[];
}

export interface ServiceTierErrors {
  minQuantity?: string;
  rowPrice?: string;
  rowCost?: string;
  totalDuration?: string;
  row?: string;
}

export interface ServiceEconomicsErrors {
  tiers: Record<string, ServiceTierErrors>;
}

export type CostTierValue = {
  min_qty: number;
  cost_per_unit: number;
};

export interface ServiceEconomicsValue {
  price_tiers: PriceTierValue[] | null;
  duration_tiers: DurationTierValue[] | null;
  /** Пустая лестница расхода уезжает пустым массивом, а не `null`: колонка
   *  `not null default '[]'`, и снятое пишем явно — патч частичный. */
  cost_tiers: CostTierValue[];
  /** ЗЕРКАЛО ОПТА ОБНУЛЯЕТСЯ ЯВНО, А НЕ «ПЕРЕСТАЁТ ПИСАТЬСЯ».
   *  Обновление услуги шлёт ЧАСТИЧНЫЙ патч, а `rowPrice` падает в
   *  легаси-ветку ровно тогда, когда `price_tiers` пуст: без явного нуля
   *  убранная цена от количества воскресала из этих двух колонок и считала
   *  деньги в записи. Читатель легаси остаётся — уходит только писатель. */
  bulk_threshold: number;
  bulk_price: number;
}
