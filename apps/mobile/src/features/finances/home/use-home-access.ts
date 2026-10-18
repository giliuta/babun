import { useMemo } from "react";
import { useMyAccess } from "@/session/access-queries";
import { useDisabledFeatures } from "@/features/settings/company-features";
import { useCurrentRole, usePlanAllows } from "@/session/tenant";
import { useSession } from "@/providers/SessionProvider";
import type { HomeView } from "../FinanceOverview";
import { financePageAccess } from "../finance-page-access";
import { financeReadRules } from "../finance-read-rules";
import type { FinanceRouteParams } from "../finance-route";
import { useFinanceRoute } from "../use-finance-route";
import type { HomeReferences } from "./use-home-references";

/** View, chip and account from the address and taps, plus the one access
 *  answer the whole screen reads. */
export function useHomeAccess(
  params: FinanceRouteParams,
  refs: Pick<HomeReferences, "accountsQuery">,
  businessToday: string,
) {
  // Аналитика — только владельцу, как в Клиентах.
  const role = useCurrentRole().data;
  // ДОКУМЕНТОВ НА БЕСПЛАТНОМ ТАРИФЕ НЕТ ВОВСЕ — ни плитки, ни разреза, ни
  // кнопки «Выставить инвойс» (канон: без права блок не показывается либо
  // только читается; «видно, но при нажатии ошибка» в продукте не бывает).
  // Настоящий запрет стоит триггером `enforce_plan_limits` в базе, здесь —
  // вид на него.
  const canUseDocuments = usePlanAllows("documents");
  // Разрез, команда и выбранный счёт — из адреса и из тапов.
  const {
    view: routeView,
    setView,
    scope,
    setScope,
    accountId,
    setAccountId,
    changeScope,
  } = useFinanceRoute(params, refs.accountsQuery.data);
  // УРОВЕНЬ ЧЕЛОВЕКА В ВЫБРАННОМ КАЛЕНДАРЕ — ОДНИМ ПРАВИЛОМ НА ВЕСЬ ЭКРАН
  // (`finance-page-access.ts`). Экран только читает ответы: что живое, что
  // серое, что можно править. Владелец карты прав не ждёт.
  const myAccessQuery = useMyAccess();
  const disabledFeatures = useDisabledFeatures();
  const userId = useSession().session?.user.id ?? null;
  const access = financePageAccess({
    role,
    map: myAccessQuery.data,
    scope,
    disabledFeatures,
    userId,
  });
  // ЧТО ВИДНО ПО СТРОКЕ — её сторона в её команде (`finance-read-rules.ts`).
  // Сотруднику строки режет сервер, а «его глазами» читают токеном владельца:
  // без этого лента показала бы расход при «Расходы: Не видит». У владельца
  // фильтры отдают вход как есть.
  const readRules = useMemo(
    () => financeReadRules({ role, map: myAccessQuery.data, today: businessToday }),
    [role, myAccessQuery.data, businessToday],
  );
  // Гасим РАЗРЕЗ документов, а не только плитку: в «Документы» приходят и
  // адресом `?view=documents`, и возвратом из записи. Закрытая уровнем панель
  // уходит туда же — на общий вид, а не показывает пустоту.
  const view: HomeView = access.view(
    !canUseDocuments && routeView === "documents" ? "all" : routeView,
  );
  // Открыта панель документов: у шапки другой предмет поиска, и она обязана
  // сказать об этом словами подсказки.
  const documentsView = view === "documents";
  return {
    canUseDocuments,
    setView,
    scope,
    setScope,
    accountId,
    setAccountId,
    changeScope,
    access,
    readRules,
    view,
    documentsView,
  };
}
