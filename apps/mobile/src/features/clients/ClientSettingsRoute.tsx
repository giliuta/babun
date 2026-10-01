import { type ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ClientsCompanyRoute } from "./ClientsCompanyRoute";
import type { ClientSettingRow } from "./settings-levels";
import { useClientSettingLevel } from "./use-client-settings";

// ПОДСТРАНИЦА ШЕСТЕРЁНКИ КЛИЕНТОВ — ЗА ПРАВОМ СВОЕЙ СТРОКИ (владелец 01.10).
// Строки «Скрыты» на шестерёнке нет, но адрес подстраницы живёт и без неё —
// ссылкой, «назад» из соседней страницы, прямым переходом. Без этой двери
// «Скрыты» открывались бы адресом. «Только видит» проходит: страница сама
// гасит правку (`useClientSettingLevel`), а пускает правку сервер.

export function ClientSettingsRoute({
  row,
  children,
}: {
  row: ClientSettingRow;
  children: ReactNode;
}) {
  return (
    <ClientsCompanyRoute kind="tab">
      <SettingDoor row={row}>{children}</SettingDoor>
    </ClientsCompanyRoute>
  );
}

function SettingDoor({ row, children }: { row: ClientSettingRow; children: ReactNode }) {
  const { team } = useLocalSearchParams<{ team?: string }>();
  const level = useClientSettingLevel(row, team || null);
  if (level === "hidden") {
    // Те же слова, что у пустой шестерёнки: страница остаётся собой.
    return (
      <Screen edges={["top"]}>
        <EmptyState fill title="Настроек пока нет" />
      </Screen>
    );
  }
  return <>{children}</>;
}
