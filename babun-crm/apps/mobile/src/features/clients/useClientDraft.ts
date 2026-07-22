import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { useCreateClient } from "@/features/clients/queries";
import {
  countryDialCode,
  DEFAULT_COUNTRY,
  formatPhoneAsYouType,
  tryToE164,
} from "@/features/clients/phone";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

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
  const [draft, setDraft] = useState<Client>(() =>
    createBlankClient({ phone: `${countryDialCode(DEFAULT_COUNTRY)} ` }),
  );
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const e164 = active ? tryToE164(draft.phone.trim(), DEFAULT_COUNTRY) : null;

  const updateDraft = (patch: Partial<Client>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const onPhoneChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      phone:
        value.length < current.phone.length
          ? value
          : formatPhoneAsYouType(value),
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
        phone: rawPhone ? formatPhoneAsYouType(rawPhone) : current.phone,
      }));
      setDuplicate(null);
      setCreateError(null);
    } catch {
      // Dismissed or unavailable. Manual input remains available.
    }
  };

  const sequence = useRef(0);
  useEffect(() => {
    if (!active) return;
    const currentSequence = ++sequence.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (sequence.current === currentSequence) setDuplicate(existing ?? null);
      } catch {
        if (sequence.current === currentSequence) setDuplicate(null);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [active, e164, tenantId]);

  const isDirty = useMemo(() => {
    if (!active) return false;
    return Boolean(
      draft.full_name.trim() ||
        draft.phone.trim() !== countryDialCode(DEFAULT_COUNTRY) ||
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
  }, [active, draft]);

  const digits = active ? draft.phone.replace(/\D/g, "").length : 0;
  const canSave = active && (e164 !== null || digits >= 5) && !create.isPending;

  const save = async () => {
    if (!canSave) return;
    setCreateError(null);

    // Debounce may not finish before a fast tap on Done. Show the existing
    // client first; a second tap intentionally allows a distinct person with
    // the same household phone.
    if (e164 && !duplicate && tenantId) {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (existing) {
          setDuplicate(existing);
          return;
        }
      } catch {
        // Offline creation is supported by the cached repository wrapper.
      }
    }

    try {
      const created = await create.mutateAsync({
        ...draft,
        phone: draft.phone.trim(),
        full_name: draft.full_name.trim(),
        phone_e164: e164,
      });
      router.replace(`/clients/${created.id}`);
    } catch (error) {
      setCreateError((error as Error).message);
    }
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
