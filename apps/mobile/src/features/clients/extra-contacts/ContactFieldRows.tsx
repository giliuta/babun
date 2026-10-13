import { Linking } from "react-native";
import type { CountryCode } from "libphonenumber-js";
import { withHomeCode } from "@/features/clients/use-phone-country";
import { dialPrefix, formatPhoneForDisplay } from "@/features/clients/phone";
import { FieldRow, RowActionButton } from "@/components/ui/card-rows";
import {
  CONTACT_FIELDS,
  type ContactFieldId,
  type ContactHolder,
} from "@/features/clients/contact-fields";
import { haptics } from "@/lib/haptics";

/** Messenger and email rows of `ClientExtraContacts` (not phone numbers). */
export function ContactFieldRows({
  client,
  update,
  country,
  column,
  addingField,
  setAddingField,
  typing,
  setTyping,
  readOnly,
  noCopy,
  compact,
  inline,
}: {
  client: ContactHolder;
  update: (patch: Partial<ContactHolder>) => Promise<boolean> | void;
  country: CountryCode;
  column?: number;
  /** Row being added right now — shown while empty. */
  addingField: ContactFieldId | null;
  setAddingField: (next: ContactFieldId | null) => void;
  /** What is being typed right now (not yet saved). */
  typing: { id: ContactFieldId; value: string } | null;
  setTyping: (next: { id: ContactFieldId; value: string } | null) => void;
  readOnly: boolean;
  noCopy: boolean;
  compact: boolean;
  inline: boolean;
}) {
  return (
    <>
      {/* Способы связи, которые не являются номером: Telegram, Instagram,
        WhatsApp на другом номере, почта. Стоят там же, где номера — это
        такой же контакт этого же человека. Строка есть, только если поле
        заполнено (или его сейчас заполняют): пустых полок не держим.
        Раньше за ними надо было уходить на страницу «Ещё» внизу карточки. */}
      {CONTACT_FIELDS.filter(
        (f) => f.display(client).trim().length > 0 || addingField === f.id,
      ).map((f) => {
        const saved = f.display(client);
        // Новая строка открывается СРАЗУ С ПРИСТАВКОЙ «@» (владелец
        // 2026-08-02: «как код страны +357 у телефона»): стереть можно, но
        // печатать её каждый раз не нужно.
        const shown = saved || (addingField === f.id ? (f.prefix ?? "") : "");
        const url = f.url(typing?.id === f.id ? typing.value : shown);
        if (column !== undefined) {
          // WhatsApp — номер: код страны в самом поле, как у телефона.
          const wa = f.id === "whatsapp";
          return (
            <FieldRow
              noCopy={noCopy}
              key={f.id}
              label={f.label}
              column={column}
              value={wa ? formatPhoneForDisplay(saved, country) : shown}
              seed={wa ? dialPrefix(country) : undefined}
              placeholder={f.placeholder}
              separated
              keyboardType={f.keyboardType}
              autoCapitalize={f.autoCapitalize}
              tabular={f.id === "whatsapp"}
              readOnly={readOnly}
              autoFocus={addingField === f.id}
              onType={(v) => setTyping({ id: f.id, value: wa ? withHomeCode(v, country) : v })}
              onSave={(v) => update(f.patch(wa ? withHomeCode(v, country) : v))}
              onEditEnd={() => {
                setAddingField(null);
                setTyping(null);
              }}
              trailing={
                url ? (
                  <RowActionButton
                    icon={f.icon}
                    color={f.color}
                    label={`${f.label} · открыть`}
                    onPress={() => {
                      haptics.tap();
                      void Linking.openURL(url);
                    }}
                  />
                ) : null
              }
            />
          );
        }
        return (
          <FieldRow
            noCopy={noCopy}
            key={f.id}
            label={f.label}
            value={shown}
            placeholder={f.placeholder}
            separated
            stacked={!inline}
            compact={compact}
            keyboardType={f.keyboardType}
            autoCapitalize={f.autoCapitalize}
            tabular={f.id === "whatsapp"}
            readOnly={readOnly}
            autoFocus={addingField === f.id}
            onType={(v) => setTyping({ id: f.id, value: v })}
            onSave={(v) => update(f.patch(v))}
            onEditEnd={() => {
              setAddingField(null);
              setTyping(null);
            }}
            trailing={
              url ? (
                <RowActionButton
                  icon={f.icon}
                  color={f.color}
                  label={`${f.label} · открыть`}
                  onPress={() => {
                    haptics.tap();
                    void Linking.openURL(url);
                  }}
                />
              ) : null
            }
          />
        );
      })}
    </>
  );
}
