import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import { useCreateClient } from "@/features/clients/queries";
import {
  countryDialCode,
  formatPhoneAsYouType,
  tryToE164,
} from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { haptics } from "@/lib/haptics";
import {
  friendlyCreateError,
  isPhoneTakenError,
} from "@/features/clients/client-create-errors";

// expo-contacts can be absent in an older dev build. A guarded require keeps
// every route bootable; the native picker simply stays hidden until rebuild.
let Contacts: typeof import("expo-contacts") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Contacts = require("expo-contacts");
} catch {
  Contacts = null;
}

export function useClientDraft(active: boolean) {
  const router = useRouter();
  const tenantId = useTenantId();
  const create = useCreateClient();
  // Код страны берём из профиля КОМПАНИИ (tenants.country), а не из константы
  // продукта: у кипрской фирмы поле открывается с «+357», у греческой — с
  // «+30». Номер, введённый со своим «+», всё равно уважается как есть.
  const country = useDefaultCountry();
  const dial = countryDialCode(country);
  const [draft, setDraft] = useState<Client>(() =>
    createBlankClient({ phone: `${countryDialCode(country)} ` }),
  );
  // Профиль компании приезжает асинхронно: если поле ещё не тронули, а код
  // оказался другим — подставляем правильный, не мешая набору.
  const seededDial = useRef(dial);
  useEffect(() => {
    if (!active || seededDial.current === dial) return;
    setDraft((cur) =>
      cur.phone.trim() === seededDial.current.trim()
        ? { ...cur, phone: `${dial} ` }
        : cur,
    );
    seededDial.current = dial;
  }, [active, dial]);
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const e164 = active ? tryToE164(draft.phone.trim(), country) : null;

  const updateDraft = (patch: Partial<Client>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const onPhoneChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      phone:
        value.length < current.phone.length
          ? value
          : formatPhoneAsYouType(value, country),
    }));
    setDuplicate(null);
    setCreateError(null);
  };

  const pickFromContacts = async () => {
    if (!Contacts) return;
    try {
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const rawPhone = contact.phoneNumbers?.[0]?.number ?? "";
      const name =
        contact.name ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ");
      setDraft((current) => ({
        ...current,
        full_name: name || current.full_name,
        phone: rawPhone ? formatPhoneAsYouType(rawPhone, country) : current.phone,
      }));
      setDuplicate(null);
      setCreateError(null);
    } catch {
      // Dismissed or unavailable. Manual input remains available.
    }
  };

  /** Поиск клиента по каноническому номеру. Сеть — авторитет, но при её
   *  отказе ищем в ОФЛАЙН-КЭШЕ: правило владельца «телефон уникален» не
   *  должно отключаться вместе с сетью, когда весь список лежит в SQLite.
   *  Тот же приём уже применён на экране чата. */
  const findDuplicate = useCallback(async (key: string): Promise<Client | null> => {
    if (!tenantId) return null;
    try {
      return (await findClientByPhoneE164(supabase, key, tenantId)) ?? null;
    } catch {
      try {
        const cached = await listClientsCached(supabase, tenantId);
        return (
          cached.find(
            (c) => (c.phone_e164 ?? tryToE164(c.phone ?? "")) === key,
          ) ?? null
        );
      } catch {
        // Ни сети, ни кэша — создать разрешаем, финальный арбитр всё равно
        // UNIQUE-индекс в базе (23505 обрабатывается ниже).
        return null;
      }
    }
  }, [tenantId]);

  const sequence = useRef(0);
  // Засов «идёт создание» — синхронный, в отличие от create.isPending.
  const savingRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const currentSequence = ++sequence.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      const existing = await findDuplicate(e164);
      if (sequence.current === currentSequence) setDuplicate(existing);
    }, 350);
    return () => clearTimeout(timer);
  }, [active, e164, tenantId, findDuplicate]);

  const isDirty = useMemo(() => {
    if (!active) return false;
    return Boolean(
      draft.full_name.trim() ||
        draft.phone.trim() !== dial ||
        draft.email.trim() ||
        draft.city.trim() ||
        draft.birthday ||
        draft.language ||
        draft.whatsapp_phone.trim() ||
        draft.telegram_username.trim() ||
        draft.instagram_username.trim() ||
        draft.phones.length ||
        draft.locations.length ||
        draft.notes.length ||
        draft.tag_ids.length ||
        draft.acquisition_source !== "unknown" ||
        draft.blacklisted
    );
  }, [active, draft, dial]);

  // Владелец 2026-07-25: телефон ОБЯЗАТЕЛЕН и УНИКАЛЕН. Уникальность
  // держится на ключе phone_e164, поэтому «5+ цифр» больше не пропуск —
  // без разбираемого номера канонического ключа нет, а значит и дубль
  // ловить нечем. Разбор чисто локальный, офлайну не мешает.
  // Имя НЕ уникально (тёзок сколько угодно, дедуп только по номеру), но
  // ОБЯЗАТЕЛЬНО (владелец 2026-07-26): безымянный клиент не находится ни
  // поиском, ни глазами в списке, а в SMS-шаблон подставлять нечего.
  const nameFilled = draft.full_name.trim().length > 0;
  // Дубль найден — сохранять НЕЧЕГО: два клиента на одном номере невозможны
  // (решение владельца), и save() при дубле молча выходил. Кнопка при этом
  // оставалась яркой и активной: тап давал вибрацию и ничего больше. Гасим её
  // здесь, а баннер под номером говорит, что делать.
  const canSave =
    active && e164 !== null && nameFilled && !duplicate && !create.isPending;

  /** Возвращает id созданного клиента — карточке это нужно, чтобы после
   *  сохранения открыть страницу объекта: она живёт отдельным роутом и
   *  несохранённого черновика не видит. null = не создали (гейт, дубль,
   *  ошибка), и тогда никакой навигации быть не должно. */
  const save = async (): Promise<string | null> => {
    // Между тапом и появлением create.isPending есть незакрытое окно: сетевая
    // перепроверка дубля. Кнопка в нём активна и молчит, поэтому второй тап
    // запускал ВТОРОЕ создание — два клиента с одним номером. Засов ставим
    // синхронно, до первого await.
    if (!canSave || savingRef.current) return null;
    savingRef.current = true;
    setCreateError(null);

    // Дебаунс мог не успеть к быстрому тапу — перепроверяем перед записью.
    if (e164 && !duplicate && tenantId) {
      const existing = await findDuplicate(e164);
      if (existing) {
        haptics.warning();
        setDuplicate(existing);
        savingRef.current = false;
        return null;
      }
    }
    // Дубль уже найден дебаунсом — создать нельзя. Раньше второй тап
    // намеренно пропускал «другого человека на том же номере»; владелец
    // это отменил: два клиента на одном номере невозможны.
    if (duplicate) {
      haptics.warning();
      savingRef.current = false;
      return null;
    }

    try {
      const created = await create.mutateAsync({
        ...draft,
        phone: draft.phone.trim(),
        full_name: draft.full_name.trim(),
        phone_e164: e164,
      });
      haptics.success();
      router.replace(`/clients/${created.id}`);
      // Засов не снимаем: экран уже уехал на карточку созданного клиента, и
      // повторное создание из этого черновика недопустимо.
      return created.id;
    } catch (error) {
      // Настоящий арбитр уникальности — частичный UNIQUE-индекс
      // clients_tenant_phone_e164_idx. Гонка двух устройств (или создание
      // в офлайне, доехавшее позже) приходит сюда как 23505. Показываем
      // того же существующего клиента, что и обычная ветка дедупа,
      // вместо сырого текста ошибки из Postgres.
      if (isPhoneTakenError(error)) {
        haptics.warning();
        if (e164 && tenantId) {
          const existing = await findDuplicate(e164);
          if (existing) {
            setDuplicate(existing);
            savingRef.current = false;
            return null;
          }
        }
        setCreateError("Клиент с таким номером уже есть");
        savingRef.current = false;
        return null;
      }
      setCreateError(friendlyCreateError(error));
    }
    savingRef.current = false;
    return null;
  };

  return {
    draft,
    updateDraft,
    duplicate,
    createError,
    e164,
    isDirty,
    canSave,
    isSaving: create.isPending,
    onPhoneChange,
    onPickContacts: Contacts ? pickFromContacts : undefined,
    save,
  };
}
