import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { parseBookingSettings, type BookingSettings } from "./online-booking";

// ОНЛАЙН-ЗАПИСЬ В ШЕСТЕРЁНКЕ КАЛЕНДАРЯ — сеть владельца. Таблица страниц
// закрыта; выключатель, ссылку и услуги читают и пишут три функции, и каждая
// сама проверяет, что звонит владелец компании этого календаря. Ответ любой
// записи — свежее состояние целиком: его и кладём в кэш.

export const bookingSettingsKey = (teamId: string | null) => ["online-booking-settings", teamId];

export function useBookingSettings(teamId: string | null) {
  return useQuery({
    queryKey: bookingSettingsKey(teamId),
    enabled: !!teamId,
    retry: 1,
    staleTime: 60_000,
    queryFn: async (): Promise<BookingSettings> => {
      const { data, error } = await supabase.rpc("online_booking_settings", { p_team: teamId as string });
      if (error) throw new Error(error.message);
      return parseBookingSettings(data);
    },
  });
}

export function useSetBookingEnabled(teamId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<BookingSettings> => {
      const { data, error } = await supabase.rpc("online_booking_set", {
        p_team: teamId as string,
        p_enabled: enabled,
      });
      if (error) throw new Error(error.message);
      return parseBookingSettings(data);
    },
    onSuccess: (next) => qc.setQueryData(bookingSettingsKey(teamId), next),
  });
}

export function useSetBookingService(teamId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { serviceId: string; online: boolean }): Promise<BookingSettings> => {
      const { data, error } = await supabase.rpc("online_booking_set_service", {
        p_team: teamId as string,
        p_service: input.serviceId,
        p_online: input.online,
      });
      if (error) throw new Error(error.message);
      return parseBookingSettings(data);
    },
    onSuccess: (next) => qc.setQueryData(bookingSettingsKey(teamId), next),
  });
}
