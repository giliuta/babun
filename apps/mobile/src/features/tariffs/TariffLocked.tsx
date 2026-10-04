import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTariffNudge } from "./use-tariff";

// ЗАКРЫТОЕ ТАРИФОМ — СЕРЫМ, А НЕ СПРЯТАНО (владелец 01.10: «клиенты серым,
// нажимаю — сверху плашка „нужно изменить тариф“ с кнопкой»). Обёртка гасит
// содержимое и перехватывает тап: вместо действия — плашка.
//
// В шторке плашка ложится ПОД её затемнение, и кнопку «Тариф» не нажать:
// `beforeNudge` закрывает шторку первым.
export function TariffLocked({
  locked,
  beforeNudge,
  children,
}: {
  locked: boolean;
  beforeNudge?: () => void;
  children: ReactNode;
}) {
  const nudge = useTariffNudge();
  if (!locked) return <>{children}</>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Нужно изменить тариф"
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
