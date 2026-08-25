import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import {
  isMessagingReady,
  MESSAGING_UNAVAILABLE_MESSAGE,
} from "./readiness";

export function MessagingFeatureBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();

  if (isMessagingReady()) return <>{children}</>;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Чаты" />
      <EmptyState
        fill
        title="Каналы ещё не подключены"
        subtitle={MESSAGING_UNAVAILABLE_MESSAGE}
        action={{ label: "Вернуться в календарь", onPress: () => router.replace("/") }}
      />
    </Screen>
  );
}
