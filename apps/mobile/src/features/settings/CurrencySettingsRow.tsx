import { useState } from "react";
import { Banknote } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { moneyName, moneySymbol } from "@babun/shared/common/utils/money";

import { CurrencySheet } from "./CurrencySheet";
import { useCurrency } from "./currency";
import { useUpdateTenant } from "./tenant";

// ВАЛЮТА КОМПАНИИ — СТРОКА И ЕЁ ШТОРКА (владелец 30.09: «валюту перенесём в
// финансы — полноценно блок „Валюта" переходит в настройки финансов»). Одна
// на бизнес (`tenants.currency`): стоит в «Настройки финансов → Вся
// компания». Раньше жила в шестерёнке календаря рядом с часовым поясом
// (06.09), теперь — там, где деньги.

export function CurrencySettingsRow({
  readOnly = false,
}: {
  /** Партнёр с «Валюта: Только видит» — строка без шторки: валюта одна на
   *  аккаунт, менять её может только владелец (`tenants_update_owner`). */
  readOnly?: boolean;
} = {}) {
  const toast = useToast();
  const currency = useCurrency();
  const updateTenant = useUpdateTenant();
  const [open, setOpen] = useState(false);

  const apply = (code: string) => {
    if (code === currency) return;
    // СМЕНА ВАЛЮТЫ СУММ НЕ ПЕРЕСЧИТЫВАЕТ (аудит 2026-09-30): €300 станут
    // «$300». Спрашиваем словами до записи — отменить её сама по себе
    // нельзя, только выбрать валюту обратно.
    confirmThen(
      `Валюта: ${moneySymbol(code)} ${moneyName(code)}?`,
      {
        message: "Все суммы останутся теми же числами — пересчёта по курсу нет.",
        confirmLabel: "Сменить",
      },
      () => save(code),
    );
  };

  const save = (code: string) => {
    updateTenant.mutate(
      { currency: code },
      {
        onSuccess: () => toast(`Валюта: ${moneySymbol(code)} ${moneyName(code)}`, "success"),
        onError: (error) => {
          const message = error instanceof Error ? error.message : "";
          toast(message || "Не удалось сменить валюту", "error");
        },
      },
    );
  };

  return (
    <>
      <SettingsRow
        tile={SETTINGS_TILE.green}
        icon={Banknote}
        title="Валюта"
        // Коротко (владелец 30.09 о шестерёнке): «Евро · €» — код EUR
        // повторял то же, что знак.
        sub={`${moneyName(currency)} · ${moneySymbol(currency)}`}
        onPress={readOnly ? undefined : () => setOpen(true)}
      />
      <CurrencySheet visible={open} onClose={() => setOpen(false)} value={currency} onApply={apply} />
    </>
  );
}
