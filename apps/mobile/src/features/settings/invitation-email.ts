import { uiLocale } from "@babun/shared/i18n/locale";
import { supabase } from "@/lib/supabase";

/**
 * ПИСЬМО-ПРИГЛАШЕНИЕ ПАРТНЁРУ (владелец 04.10). Зовётся сразу после
 * `create_invitation`: edge-функция `invite-email` шлёт письмо с адреса Babun
 * на языке того, кто зовёт. Права, лимиты и штамп отправки проверяет сервер
 * (`claim_invitation_email`).
 *
 * Молча: приглашение уже создано и ждёт партнёра во «Входящих» его аккаунта,
 * письмо — лишь подсказка, что туда заглянуть. Отказ (нет ключа Resend, лимит,
 * сеть) не должен выглядеть как неудавшееся приглашение.
 */
export function sendInvitationEmail(invitationId: string): void {
  void supabase.functions
    .invoke("invite-email", {
      body: { invitation_id: invitationId, locale: uiLocale() },
    })
    .catch(() => undefined);
}
