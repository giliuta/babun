// КАБИНЕТ → SMS — баланс, пополнение и отправка всей компании (STORY-089).
// Тело — в features/sms. С `?tenant=` — баланс аккаунта, который пригласил:
// партнёр видит и пополняет его по праву «SMS».
import { CabinetAccountRoute } from "@/session/CabinetAccountRoute";
import { SmsScreen } from "@/features/sms/SmsScreen";

export default function CabinetSmsRoute() {
  return (
    <CabinetAccountRoute>
      <SmsScreen />
    </CabinetAccountRoute>
  );
}
