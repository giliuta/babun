import { type ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import type { FinanceSettingRow } from "./settings-levels";
import { useFinanceSettingLevelsOf } from "./use-finance-settings";

// ПОДСТРАНИЦА ШЕСТЕРЁНКИ «ФИНАНСОВ» — ЗА ПРАВОМ СВОЕЙ СТРОКИ (03.10, как
// `clients/ClientSettingsRoute`). Строки «Скрыты» на шестерёнке нет, но адрес
// подстраницы живёт и без неё — ссылкой, «назад», прямым переходом. Без этой
// двери «Скрыты» открывались бы адресом. «Только видит» проходит: страница
// сама гасит правку, а пускает правку сервер.

export function FinanceSettingsRoute({
  row,
  title,
  children,
}: {
  /** Право строки; страница нескольких строк (категории разных видов)
   *  открыта, если открыта хоть одна. */
  row: FinanceSettingRow | readonly FinanceSettingRow[];
  /** Шапка страницы — та же, что у неё самой: закрытая дверь не меняет
   *  места, где человек оказался. */
  title: string;
  children: ReactNode;
}) {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const levels = useFinanceSettingLevelsOf()(team || null);
  const rows: readonly FinanceSettingRow[] = typeof row === "string" ? [row] : row;
  if (rows.every((key) => levels[key] === "hidden")) {
    // Те же слова, что у пустой шестерёнки: страница остаётся собой.
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState fill title="Настроек пока нет" />
      </Screen>
    );
  }
  return <>{children}</>;
}
