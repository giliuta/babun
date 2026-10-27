import type { CountryCode } from "libphonenumber-js";
import type { PhoneEntry } from "@babun/shared/local/clients";
import { useToast } from "@/components/ui/Toast";
import { findQuickClientDuplicate } from "@/features/appointments/booking-prefill";
import { useClients } from "@/features/clients/queries";
import { formatPhoneAsYouType, isDialOnly, tryToE164 } from "@/lib/phone";

// ДОП. НОМЕР ТОЖЕ ПРОВЕРЯЕТСЯ НА ДУБЛЬ. Уникальный индекс стоит только на
// основном номере, и «Телефон 2» с номером другого клиента ложился молча:
// два человека с одним номером, звонок определялся не тем. Номер не
// запрещаем — у семьи бывает общий домашний, — а говорим, у кого он уже есть.

/** Сказать, если сохранённый доп. номер — основной номер другого клиента. */
export function useExtraPhoneTaken(
  clientId: string | null | undefined,
  country: CountryCode,
): (number: string) => void {
  const { data: clients = [] } = useClients();
  const toast = useToast();
  return (number) => {
    const e164 = tryToE164(number, country);
    if (!e164) return;
    const others = clients.filter((c) => c.id !== clientId);
    const owner = findQuickClientDuplicate(others, e164, country);
    if (!owner) return;
    toast(`Этот номер уже у клиента «${owner.full_name || owner.phone}»`, "warn");
  };
}

/** Набор нового номера кончился: номер ложится в том же виде, что основной
 *  («+357 99 000 101»), — шторки читают его из данных и печатают как есть.
 *  Не на каждый символ: подменённое под пальцем значение съедало цифру. */
export function useExtraPhoneFinish(
  phones: { apply: (fn: (items: PhoneEntry[]) => PhoneEntry[]) => Promise<boolean> },
  clientId: string | null | undefined,
  country: CountryCode,
): (id: string) => void {
  const warnIfTaken = useExtraPhoneTaken(clientId, country);
  return (id) => {
    let typed = "";
    void phones
      .apply((all) =>
        all.map((p) => {
          if (p.id !== id || isDialOnly(p.number, country)) return p;
          typed = p.number;
          return { ...p, number: formatPhoneAsYouType(p.number, country) };
        }),
      )
      .then(() => {
        if (typed) warnIfTaken(typed);
      });
  };
}
