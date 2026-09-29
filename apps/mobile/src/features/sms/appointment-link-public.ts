import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  isAppointmentLinkToken,
  parseAppointmentLink,
  type AppointmentLinkInfo,
} from "./appointment-link";

// ПУБЛИЧНАЯ СТРАНИЦА /r/<токен> — сеть (STORY-089, волна 7). Клиент без
// входа: обе функции отданы роли anon и знают только токен
// (`appointment_link_lookup`, `appointment_link_answer`). Ответ базы — всегда
// свежее состояние записи, его страница и показывает.

export const appointmentLinkKey = (token: string | null) => ["appointment-link", token];

export function useAppointmentLinkLookup(token: string | null) {
  return useQuery({
    queryKey: appointmentLinkKey(token),
    enabled: !!token,
    retry: 1,
    staleTime: 30_000,
    queryFn: async (): Promise<AppointmentLinkInfo> => {
      if (!isAppointmentLinkToken(token)) throw new Error("Некорректная ссылка");
      const { data, error } = await supabase.rpc("appointment_link_lookup", { p_token: token });
      if (error) throw new Error(friendlyNetworkError(error.message));
      return parseAppointmentLink(data);
    },
  });
}

export async function answerAppointmentLink(
  token: string,
  answer: "confirmed" | "cancelled",
): Promise<AppointmentLinkInfo> {
  const { data, error } = await supabase.rpc("appointment_link_answer", {
    p_token: token,
    p_answer: answer,
  });
  if (error) throw new Error(friendlyNetworkError(error.message));
  return parseAppointmentLink(data);
}

function friendlyNetworkError(message: string): string {
  return /fetch|network|failed to/i.test(message) ? "Нет связи. Проверьте интернет и повторите." : message;
}
