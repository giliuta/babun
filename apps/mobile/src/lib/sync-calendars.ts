import { CAN_PAY_HERE } from "@/lib/pay-here";
import { supabase } from "@/lib/supabase";

// ЧИСЛО КАЛЕНДАРЕЙ В ПОДПИСКЕ — СЛЕДОМ ЗА КАЛЕНДАРЯМИ (цена за календарь,
// владелец 12.10: «добавили календарь — сумма выросла со следующего платежа»).
// После создания, архива и возврата календаря `tariff-checkout` (sync) ставит
// количество в подписке Stripe по живым календарям — без доплаты сегодня.
// Молча и без ожидания: нет подписки — сервер ответит «нечего», нет сети —
// вебхук сверит количество перед счётом (`invoice.upcoming`).
//
// Только там, где платят (`CAN_PAY_HERE`, сайт): в приложении из магазина
// не трогаем подписку вовсе — там её сверяет вебхук.
export function syncCalendarBilling(): void {
  if (!CAN_PAY_HERE) return;
  void supabase.functions
    .invoke("tariff-checkout", { body: { action: "sync" } })
    .catch(() => undefined);
}
