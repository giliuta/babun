import { type ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole, useTenant } from "@/session/tenant";
import { ClientsScopeProvider } from "@/session/company-scope";
import { clientsRouteDecision, type RouteKind } from "@/session/clients-company";
import { useClientsSources } from "./sources";

// ВОРОТА ВКЛАДКИ «КЛИЕНТЫ» (STORY-082): вся страница и вся архитектура
// остаются.
//
// Граница по роли дала бы мастеру на весь экран «Недостаточно прав». Поэтому
// экран спрашивает не роль, а ИСТОЧНИК: своя
// компания, компания-работодатель, открывшая клиентов, или клиент записи.
// Ответ один на весь экран и его блоки — он же объявляется контекстом.
//
// Слов на экране три, и все они честные:
//   • ждём — ещё не знаем, какие компании у человека;
//   • «клиентов нет» — ни своей компании, ни открытых работодателем;
//   • «не найден» — ссылка на компанию, которой у него нет.
// Кнопок внутри нет: действие экрана живёт в футере (канон 7.1).

// ЗАГОЛОВОК БЕЗ ПОДПИСИ (канон пустых состояний): подпись есть только у
// ошибки. Три объяснения — почему компании нет, чья это ссылка и кто ведёт
// визиты — превращали бы экран в оправдание. Объяснения живут в коде, рядом с правилом.
const WORDS: Record<"no-company" | "not-found" | "not-allowed", string> = {
  "no-company": "Здесь будут клиенты",
  "not-found": "Клиент не найден",
  "not-allowed": "Это часть компании",
};

export function ClientsCompanyRoute({
  kind,
  forceActive,
  children,
}: {
  kind: RouteKind;
  /** Вход из записи и календаря: карточка всегда в компании календаря. */
  forceActive?: boolean;
  children: ReactNode;
}) {
  const params = useLocalSearchParams<{ tenant?: string }>();
  const activeTenantId = useTenantId();
  const activeRole = useCurrentRole().data;
  const activeName = useTenant().data?.name ?? null;
  const sources = useClientsSources();

  const decision = clientsRouteDecision({
    kind,
    tenantParam: params.tenant ?? null,
    activeTenantId,
    activeRole,
    activeName,
    sources,
    forceActive,
  });

  // СЕРВЕР МОЛЧИТ, А ЗАПОМНЕННОГО НЕТ (первый запуск без сети): ждать
  // нечего — честное «Нет связи» с «Повторить», а не вечная загрузка.
  if (decision.state === "wait" && sources.failed) {
    return (
      <Screen edges={["top"]}>
        <EmptyState
          state="error"
          fill
          title="Нет связи с сервером"
          subtitle="Клиенты загрузятся, как только сервер ответит."
          action={{ label: "Повторить", onPress: sources.retry }}
        />
      </Screen>
    );
  }

  if (decision.state === "wait") {
    return (
      <Screen edges={["top"]}>
        <EmptyState state="loading" fill title="Загрузка" />
      </Screen>
    );
  }

  if (decision.state === "words") {
    return (
      <Screen edges={["top"]}>
        <EmptyState fill title={WORDS[decision.reason]} />
      </Screen>
    );
  }

  return <ClientsScopeProvider scope={decision.scope}>{children}</ClientsScopeProvider>;
}
