import { useToast } from "@/components/ui/Toast";
import type { ContactHolder } from "@/features/clients/contact-fields";
import {
  getMasterProfile,
  useUpdateMasterProfile,
  type MasterProfile,
} from "@/features/reference/master-profile";
import type { Master } from "@/features/reference/queries";

// ОДИН ПИСАТЕЛЬ ПРОФИЛЯ КАРТОЧКИ МАСТЕРА — для «Личного», «Банка и налогов»,
// контактов и заметки. Сервер (`patch_master_profile`, только владелец)
// сливает патч в профиль поверх: вложенное (`contacts`) уходит целиком.

/** Стабильная пустая ссылка: новый массив на каждый рендер дёргал бы
 *  пересинхронизацию писателя номеров. */
const NO_PHONES: ContactHolder["phones"] = [];

/** Контакты сотрудника в форме, которую понимают строки клиента. */
export function contactsHolderOf(profile: MasterProfile): ContactHolder {
  const c = profile.contacts ?? {};
  return {
    phones: c.phones ?? NO_PHONES,
    whatsapp_phone: c.whatsapp_phone ?? "",
    telegram_username: c.telegram_username ?? "",
    instagram_username: c.instagram_username ?? "",
    email: c.email ?? "",
  };
}

const NO_PROFILE: MasterProfile = {};

/** `card` null — у человека нет карточки мастера: писать некуда, запись
 *  отвечает «не удалось» и ничего не шлёт. */
export function useMasterProfileWrite(card: Master | null) {
  const toast = useToast();
  const update = useUpdateMasterProfile();
  const profile = card ? getMasterProfile(card) : NO_PROFILE;

  const writeAsync = async (patch: MasterProfile): Promise<boolean> => {
    if (!card) return false;
    try {
      await update.mutateAsync({ id: card.id, patch });
      return true;
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : "Не удалось сохранить", "error");
      return false;
    }
  };
  const write = (patch: MasterProfile) => void writeAsync(patch);

  // Текст: пустое стирает поле — JSON null, а не undefined (тот пропал бы при
  // сериализации, и правка молча не ушла бы).
  const writeText = (field: keyof MasterProfile, next: string) => {
    const trimmed = next.trim();
    const current = ((profile[field] as string | undefined) ?? "").trim();
    if (trimmed === current) return;
    write({ [field]: trimmed || null } as unknown as MasterProfile);
  };

  const writeContacts = (patch: Partial<ContactHolder>) =>
    writeAsync({ contacts: { ...(profile.contacts ?? {}), ...patch } });

  return { profile, write, writeAsync, writeText, writeContacts };
}
