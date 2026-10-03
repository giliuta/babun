// КАБИНЕТ → SMS — баланс, пополнение и отправка всей компании (STORY-089;
// владелец 29.09: «баланс и пополнение — это всё будет Кабинет SMS»). Тело —
// в features/sms. С `?tenant=` — баланс аккаунта, который пригласил (04.10):
// партнёр видит и пополняет его по праву «SMS».
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { SmsScreen } from "@/features/sms/SmsScreen";

export default function CabinetSmsRoute() {
  return (
    <CabinetAccountRoute>
      <SmsScreen />
    </CabinetAccountRoute>
  );
}
