import { CAN_PAY_HERE } from "@/lib/pay-here";
import { supabase } from "@/lib/supabase";

// ПОДПИСКИ — СЛЕДОМ ЗА КАЛЕНДАРЯМИ (у каждого календаря своя оплата).
// После архива, удаления и возврата календаря `tariff-checkout` (sync)
// отменяет подписку ушедшего календаря в конце оплаченного срока, а у
// вернувшегося снимает свою же отмену — без доплаты и возврата сегодня.
// Молча и без ожидания: подписки нет — сервер ответит «нечего», нет сети —
// вебхук снимет подписку архивного календаря перед счётом
// (`invoice.upcoming`).
//
// Только там, где платят (`CAN_PAY_HERE`): в приложении из магазина
// подписку не трогаем вовсе — там её сверяет вебхук.
export function syncCalendarBilling(): void {
  if (!CAN_PAY_HERE) return;
  void supabase.functions
    .invoke("tariff-checkout", { body: { action: "sync" } })
    .catch(() => undefined);
}
