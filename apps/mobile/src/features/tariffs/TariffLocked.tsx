import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { TARIFF_LOCKED_HINT, useTariffNudge } from "./use-tariff";

// ЗАКРЫТОЕ ТАРИФОМ — СЕРЫМ, А НЕ СПРЯТАНО: тап открывает сверху плашку «нужно
// оплатить календарь» с кнопкой. Обёртка гасит
// содержимое и перехватывает тап: вместо действия — плашка.
//
// В шторке плашка ложится ПОД её затемнение, и кнопку «Тариф» не нажать:
// `beforeNudge` закрывает шторку первым.
export function TariffLocked({
  locked,
  beforeNudge,
  teamId,
  children,
}: {
  locked: boolean;
  beforeNudge?: () => void;
  /** Календарь, чью оплату просит плашка; не назван — открытый в календаре. */
  teamId?: string | null;
  children: ReactNode;
}) {
  const nudge = useTariffNudge(teamId);
  if (!locked) return <>{children}</>;
  return (
    <Pressable
      accessibilityRole="button"
      // В приложении из магазина — без «измените тариф» (`TARIFF_LOCKED_HINT`).
      accessibilityHint={TARIFF_LOCKED_HINT}
      onPress={() => {
        beforeNudge?.();
        nudge();
      }}
    >
      <View pointerEvents="none" style={{ opacity: 0.4 }}>
        {children}
      </View>
    </Pressable>
  );
}
