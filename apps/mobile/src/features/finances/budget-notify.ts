import type { QueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { money } from "@babun/shared/common/utils/money";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { listTransactionsForRange } from "@babun/shared/db/repositories/finance-transactions";
import { getNotificationsModule } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import {
  currentRoleQueryKey,
  financeCategoriesQueryKey,
} from "@/lib/company-query-keys";
import { todayYmd } from "@/features/invoices/format";
import {
  budgetAlerts,
  hasBudget,
  monthOf,
  monthSpendByCategory,
  type BudgetSeen,
} from "./category-budget";

// УВЕДОМЛЕНИЕ О БЮДЖЕТЕ — КОМУ, КОГДА И СКОЛЬКО РАЗ.
//
// Кому: ВЛАДЕЛЬЦУ. Бюджет ставит он и справочник категорий — его экран;
// мастеру, внёсшему топливо, «бюджет компании превышен» ни о чём не говорит.
//
// Когда: сразу после записи расхода на этом телефоне (`checkBudgetsAfterWrite`
// из мутаций журнала) и когда владелец открывает «Финансы»
// (`useBudgetWatch`) — так он узнает и о расходе, который внёс сотрудник со
// своего телефона. Мгновенно на телефон владельца с чужого — только пушем с
// сервера; до ключа Apple это ждёт.
//
// Сколько раз: один раз на порог за месяц (`budgetAlerts`), что уже сказано —
// помнит устройство. Проверки идут очередью: мутация и открытие «Финансов»
// в один момент иначе прочли бы одну память и сказали бы одно и то же дважды.
//
// Уведомление локальное и мгновенное (`trigger: null`), мимо реестра
// напоминаний: планировать нечего, а реестр держит место под запланированные.

const SEEN_KEY = "babun:finance.budgetAlerts.v1";

type SeenStore = Record<string, BudgetSeen>;

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function readSeen(tenantId: string): BudgetSeen {
  try {
    const all = getStorage().get<SeenStore>(SEEN_KEY);
    const mine = all && typeof all === "object" ? all[tenantId] : null;
    return mine && typeof mine === "object" ? mine : {};
  } catch {
    return {};
  }
}

function writeSeen(tenantId: string, seen: BudgetSeen): void {
  try {
    const all = getStorage().get<SeenStore>(SEEN_KEY) ?? {};
    getStorage().set(SEEN_KEY, { ...all, [tenantId]: seen });
  } catch {
    // Память порогов — удобство: без неё худшее — повтор уведомления.
  }
}

async function presentNow(title: string, body: string): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { type: "finance-budget" } },
      trigger: null,
    });
  } catch {
    // Нет модуля или iOS отказал — бюджет всё равно виден в справочнике.
  }
}

/** Разрешение на уведомления — в момент, когда владелец ставит бюджет: тогда
 *  вопрос iOS понятен без объяснений. Отказ ничего не ломает. */
export async function askBudgetNotificationPermission(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || !current.canAskAgain) return;
    await Notifications.requestPermissionsAsync();
  } catch {
    // ignore
  }
}

/** Сравнить месяц с бюджетами и сообщить новые пороги. */
export function runBudgetAlerts(
  tenantId: string,
  categories: readonly FinanceCategory[],
  spend: ReadonlyMap<string, number>,
  monthKey: string,
): Promise<void> {
  return enqueue(async () => {
    const { notices, next } = budgetAlerts(
      categories,
      spend,
      readSeen(tenantId),
      monthKey,
      (n) => money(n),
    );
    writeSeen(tenantId, next);
    for (const n of notices) await presentNow(n.title, n.body);
  });
}

/** После записи в журнал: если у компании есть бюджеты — пересчитать месяц
 *  по ним и сообщить. Чтение узкое: только расходы категорий с бюджетом. */
export function checkBudgetsAfterWrite(
  qc: QueryClient,
  tenantId: string | null,
): void {
  if (!tenantId) return;
  if (qc.getQueryData(currentRoleQueryKey(tenantId)) !== "owner") return;
  const categories =
    qc.getQueryData<FinanceCategory[]>(financeCategoriesQueryKey(tenantId)) ?? [];
  const budgeted = categories.filter(hasBudget);
  if (budgeted.length === 0) return;
  const month = monthOf(todayYmd());
  void listTransactionsForRange(supabase, tenantId, month.from, month.to, {
    types: ["expense"],
    categoryIds: budgeted.map((c) => c.id),
  })
    .then((rows) =>
      runBudgetAlerts(tenantId, categories, monthSpendByCategory(rows), month.key),
    )
    .catch(() => {});
}
