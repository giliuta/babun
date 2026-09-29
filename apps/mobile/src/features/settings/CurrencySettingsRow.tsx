import { useState } from "react";
import { Banknote } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { moneyName, moneySymbol } from "@babun/shared/common/utils/money";

import { CurrencySheet } from "./CurrencySheet";
import { useCurrency } from "./currency";
import { useUpdateTenant } from "./tenant";

// ВАЛЮТА КОМПАНИИ — СТРОКА И ЕЁ ШТОРКА (владелец 30.09: «валюту перенесём в
// финансы — полноценно блок „Валюта" переходит в настройки финансов»). Одна
// на бизнес (`tenants.currency`): стоит в «Настройки финансов → Вся
// компания». Раньше жила в шестерёнке календаря рядом с часовым поясом
// (06.09), теперь — там, где деньги.

export function CurrencySettingsRow() {
  const toast = useToast();
  const currency = useCurrency();
  const updateTenant = useUpdateTenant();
  const [open, setOpen] = useState(false);

  const apply = (code: string) => {
    if (code === currency) return;
    updateTenant.mutate(
      { currency: code },
      {
        onSuccess: () => toast(`Валюта: ${moneySymbol(code)} ${moneyName(code)}`, "success"),
        onError: (error) => {
          const message = error instanceof Error ? error.message : "";
          toast(
            /currency_check|check constraint/i.test(message)
              ? "База пока принимает пять валют — нужна миграция"
              : message || "Не удалось сменить валюту",
            "error",
          );
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
        sub={`${moneyName(currency)} · ${moneySymbol(currency)} · ${currency}`}
        onPress={() => setOpen(true)}
      />
      <CurrencySheet visible={open} onClose={() => setOpen(false)} value={currency} onApply={apply} />
    </>
  );
}
