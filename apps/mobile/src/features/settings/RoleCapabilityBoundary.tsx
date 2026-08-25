import type { ReactNode } from "react";
import { useRouter, type Href } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { signOutAndWipe } from "@/lib/auth-clear";
import { can, ROLE_LABELS, type AppCapability } from "./role-policy";
import { useCurrentRole } from "./tenant";

/**
 * Способности, чей отказ ОБЪЯСНЯЮТ, а не обвиняют (ТЗ 2026-08-10 §7, §8).
 * «Недостаточно прав» человек читает как поломку продукта, хотя на деле дверь
 * просто не открыта владельцем. Заголовок раздела здесь всегда во
 * множественном числе — «Счета», «Финансы», «Инвойсы», «Документы», — поэтому
 * фраза собирается из него и остаётся грамматически честной на всех четырёх.
 * Остальные способности говорят прежним текстом про роль.
 */
const EXPLAINED_CAPABILITIES: ReadonlySet<AppCapability> = new Set([
  "view-finances",
]);

export function RoleCapabilityBoundary({
  capability,
  title,
  fallbackHref = "/",
  children,
}: {
  capability: AppCapability;
  title: string;
  fallbackHref?: Href;
  children: ReactNode;
}) {
  const router = useRouter();
  const roleQuery = useCurrentRole();

  // FAIL-OPEN ПО ПОСЛЕДНЕЙ ИЗВЕСТНОЙ РОЛИ. Роль перепроверяется раз в минуту,
  // и обрыв связи роняет ЛЮБОЙ из этих опросов. Пока react-query держит
  // прошлый успешный ответ, он и есть правда: выкидывать владельца с экрана
  // денег из-за пропавшего вайфая — это поломка, а не безопасность. Отзыв
  // членства приезжает ОТВЕТОМ сервера, а не его отсутствием, и следующий
  // успешный опрос закроет раздел сам.
  const role = roleQuery.data;

  if (role === undefined) {
    if (roleQuery.isError) {
      return (
        <Screen edges={["top"]}>
          <ScreenHeader title={title} />
          <EmptyState
            state="error"
            fill
            title="Нет связи с сервером"
            subtitle="Права подтвердим, как только появится интернет."
            action={{ label: "Повторить", onPress: () => void roleQuery.refetch() }}
          />
        </Screen>
      );
    }
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (role === null) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Нет доступа" />
        <EmptyState
          fill
          title="Вы больше не состоите в этой компании"
          subtitle="Войдите заново или попросите владельца восстановить доступ."
          action={{ label: "Выйти", onPress: () => void signOutAndWipe() }}
        />
      </Screen>
    );
  }

  if (!can(role, capability)) {
    // Кнопки здесь нет намеренно: уводить с экрана нечем — человек пришёл
    // сюда сам, и «Вернуться» повторяет системный жест «назад».
    if (EXPLAINED_CAPABILITIES.has(capability)) {
      return (
        <Screen edges={["top"]}>
          <ScreenHeader title={title} />
          <EmptyState
            fill
            title={`${title} появятся здесь, когда владелец откроет доступ`}
          />
        </Screen>
      );
    }
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Недостаточно прав" />
        <EmptyState
          fill
          title="Этот раздел недоступен для вашей роли"
          subtitle={`Ваша роль — ${ROLE_LABELS[role].toLowerCase()}. Доступные рабочие разделы остались без изменений.`}
          action={{ label: "Вернуться", onPress: () => router.replace(fallbackHref) }}
        />
      </Screen>
    );
  }

  return <>{children}</>;
}
