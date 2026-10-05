import { useEffect, useRef } from "react";
import { useAccountScope } from "@/features/cabinet/account-scope";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useStartTrial, useTariff } from "./use-tariff";

// ПРОБНЫЙ ВКЛЮЧАЕТСЯ САМ — В ПРИЛОЖЕНИИ ИЗ МАГАЗИНА (владелец 04.10 вечером:
// «первую версию без тарифа выбираем — пусть автоматически включается на
// 14 дней, а потом уже добавление тарифа»).
//
// В приложении из App Store / Google Play тариф не выбирают и не оплачивают
// (`lib/pay-here.ts`), поэтому новый владелец без тарифа сразу получает
// пробный «Про» на 14 дней — один раз в жизни аккаунта: сервер (`start_trial`)
// сам отказывает, если пробный уже был. Только свой аккаунт и только его
// владелец; партнёр в чужой команде тариф не трогает. На сайте всё как было:
// там пробный — кнопкой на странице «Тариф», с выбором тарифа.
//
// Без интерфейса: тот же тихий компонент, что `TeamActivityNotifier`.

/** Тариф пробного по умолчанию — основной: клиенты, команды, SMS. */
export const AUTO_TRIAL_TIER = "pro" as const;

export function AutoTrial() {
  const scope = useAccountScope();
  const { loading, state } = useTariff();
  const startTrial = useStartTrial();
  const asked = useRef(false);

  const eligible =
    !CAN_PAY_HERE &&
    !loading &&
    scope.viewRole === "owner" &&
    !scope.foreign &&
    !state.forever &&
    !state.paid &&
    !state.trial &&
    !state.trialUsed;

  useEffect(() => {
    if (!eligible || asked.current) return;
    asked.current = true;
    // Отказ сервера (пробный уже был, нет связи) — молча: следующий запуск
    // приложения попробует снова, а тариф остаётся видимым в Кабинете.
    startTrial.mutate(AUTO_TRIAL_TIER);
  }, [eligible, startTrial]);

  return null;
}
