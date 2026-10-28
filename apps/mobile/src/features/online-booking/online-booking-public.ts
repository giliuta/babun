import { useQuery } from "@tanstack/react-query";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { supabase } from "@/lib/supabase";
import {
  isBookingToken,
  parseBookingDays,
  parseBookingDone,
  parseBookingPage,
  type BookingDay,
  type BookingDone,
  type BookingPage,
} from "./online-booking";

// ПУБЛИЧНАЯ СТРАНИЦА /b/<токен> — сеть. Заказчик без входа: все три функции
// отданы роли anon и знают только токен (`online_booking_page`,
// `online_booking_slots`, `online_booking_create`). Окна живут недолго —
// их забирают другие заказчики, поэтому запрос окон свежий на каждом
// открытии услуги.

const bookingPageKey = (token: string | null) => ["online-booking", token];
const bookingSlotsKey = (token: string | null, serviceId: string | null) => [
  "online-booking",
  token,
  "slots",
  serviceId,
];

export function useBookingPage(token: string | null) {
  return useQuery({
    queryKey: bookingPageKey(token),
    enabled: !!token,
    retry: 1,
    staleTime: 60_000,
    queryFn: async (): Promise<BookingPage> => {
      if (!isBookingToken(token)) throw new Error("Некорректная ссылка");
      const { data, error } = await supabase.rpc("online_booking_page", { p_token: token });
      if (error) throw new Error(friendlyError(error.message));
      return parseBookingPage(data);
    },
  });
}

export function useBookingSlots(token: string | null, serviceId: string | null) {
  return useQuery({
    queryKey: bookingSlotsKey(token, serviceId),
    enabled: !!token && !!serviceId,
    retry: 1,
    staleTime: 0,
    queryFn: async (): Promise<BookingDay[]> => {
      const { data, error } = await supabase.rpc("online_booking_slots", {
        p_token: token as string,
        p_service: serviceId as string,
      });
      if (error) throw new Error(friendlyError(error.message));
      return parseBookingDays(data);
    },
  });
}

export async function createBooking(input: {
  token: string;
  serviceId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
}): Promise<BookingDone> {
  const { data, error } = await supabase.rpc("online_booking_create", {
    p_token: input.token,
    p_service: input.serviceId,
    p_date: input.date,
    p_time: input.time,
    p_name: input.name,
    p_phone: input.phone,
  });
  if (error) throw new BookingError(friendlyError(error.message), error.hint ?? null);
  return parseBookingDone(data);
}

/** Отказ базы с кодом (`online:taken` — окно заняли, пора обновить окна). */
export class BookingError extends Error {
  constructor(
    message: string,
    readonly hint: string | null,
  ) {
    super(message);
  }
}

/** Обрыв — словами; отказ базы приходит по-русски мимо плагина, поэтому
 *  переводится здесь: страницу читает заказчик на своём языке. */
function friendlyError(message: string): string {
  return /fetch|network|failed to/i.test(message)
    ? "Нет связи. Проверьте интернет и повторите."
    : tDynamic(message);
}
