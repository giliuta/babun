// ContactsBlock — mobile port of the web client-card Contacts block
// (apps/web/src/components/clients/blocks/ContactsBlock.tsx).
//
// Reference block — collapsed by default (CollapsibleCard); the closed row
// shows «{телефон} · ещё N». Expanded:
// primary phone + extra phones (each with an optional name like
// «Жена · Мария») + messengers (Telegram / Instagram / WhatsApp).
// Editable inline. Each phone has a call (tel:) action; each messenger
// has an «Открыть» action via Linking. Presentational: persists via
// `update(patch)`.
//
// Every input buffers keystrokes locally and commits ONCE on blur
// (DraftInput below — same pattern as PersonalBlock's EditableField).
// The web block writes to a synchronous local context on every change;
// here `update` is a Supabase mutation, so per-keystroke commits used
// to fire a network PATCH per character and the async cache write-back
// raced (and dropped) fast typing.

import { useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Instagram, Phone as PhoneIcon, Send, X } from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import {
  instagramUrl,
  telegramUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { tryToE164 } from "@/features/clients/phone";
import { useThemeColors } from "@/theme/colors";
import { MOBILE_CHANNEL_COLORS } from "@/theme/readable-color";

interface ContactsBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
  /** Creation already owns the primary phone in the identity card. */
  hidePrimaryPhone?: boolean;
  /** Телефоны (основной + дополнительные) живут в блоке идентичности —
   *  здесь остаются только мессенджеры. Один факт = одно место. */
  hidePhones?: boolean;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function dialUrl(phone: string): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "");
  if (digits.replace(/\D/g, "").length < 3) return null;
  return `tel:${digits}`;
}

// Draft-buffered TextInput: keystrokes stay local, `onCommit` fires once
// on blur (only when the trimmed value actually changed). Mirrors
// PersonalBlock's EditableField so ContactsBlock stops mutating Supabase
// per character.
function DraftInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
} & Omit<TextInputProps, "value" | "onChangeText" | "onBlur">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      keyboardAppearance="light"
      accessibilityLabel={rest.accessibilityLabel ?? rest.placeholder}
      value={draft}
      onChangeText={setDraft}
      onBlur={() => {
        if (draft.trim() !== value) onCommit(draft.trim());
      }}
      {...rest}
    />
  );
}

export default function ContactsBlock({
  client,
  update,
  hidePrimaryPhone = false,
  hidePhones = false,
}: ContactsBlockProps) {
  const t = useThemeColors();
  const extras = client.phones ?? [];

  const addExtra = () => {
    const next: PhoneEntry = {
      id: genId("phone"),
      number: "",
      name: "",
      label: "Доп.",
    };
    update({ phones: [...extras, next] });
  };

  const updateExtra = (id: string, patch: Partial<PhoneEntry>) =>
    update({
      phones: extras.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });

  const removeExtra = (id: string) =>
    update({ phones: extras.filter((p) => p.id !== id) });

  const tg = (client.telegram_username || "").replace(/^@/, "");
  const ig = (client.instagram_username || "").replace(/^@/, "");
  const waDigits = (client.whatsapp_phone || "").replace(/\D/g, "");

  const inputFill = t.fill;

  // Collapsed-row summary: primary phone «+357 99… · ещё 1» (mockup).
  const messengerCount = [tg, ig, waDigits].filter(Boolean).length;
  const summary = hidePhones
    ? messengerCount > 0
      ? `${messengerCount}`
      : "Пусто"
    : !hidePrimaryPhone && client.phone
      ? `${client.phone}${extras.length ? ` · ещё ${extras.length}` : ""}`
      : extras.length
        ? `ещё ${extras.length}`
        : "";

  return (
    <CollapsibleCard title="Контакты" summary={summary}>
      <View className="gap-3 px-1 pt-1">
        {/* Primary phone */}
        {!hidePrimaryPhone && !hidePhones ? (
          <View className="flex-row items-center gap-2">
            <Text className="w-28 shrink-0 text-xs" style={{ color: t.sub }}>
              Основной телефон
            </Text>
            <DraftInput
              value={client.phone}
              onCommit={(v) => update({ phone: v, phone_e164: tryToE164(v) })}
              placeholder="+357 99 ..."
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType="phone-pad"
              accessibilityLabel="Основной телефон"
              className="h-11 flex-1 rounded-lg px-3 text-[13px]"
              style={{ backgroundColor: inputFill, color: t.ink }}
            />
            {dialUrl(client.phone) ? (
              <Pressable
                onPress={() => Linking.openURL(dialUrl(client.phone) as string)}
                accessibilityRole="button"
                accessibilityLabel="Позвонить на основной телефон"
                className="h-11 w-11 items-center justify-center rounded-lg active:opacity-70"
                style={{ backgroundColor: `${t.success}1a` }}
              >
                <PhoneIcon color={t.success} size={14} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Extra phones — только если телефоны не уехали в идентичность */}
        {(hidePhones ? [] : extras).map((p) => (
          <View key={p.id} className="flex-row items-center gap-2">
            <DraftInput
              value={p.name ?? ""}
              onCommit={(v) => updateExtra(p.id, { name: v })}
              placeholder="Жена"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Имя контакта"
              className="h-11 w-20 rounded-lg px-2 text-[12px]"
              style={{ backgroundColor: inputFill, color: t.ink }}
            />
            <DraftInput
              value={p.number}
              onCommit={(v) => updateExtra(p.id, { number: v })}
              placeholder="+357 ..."
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType="phone-pad"
              accessibilityLabel="Дополнительный телефон"
              className="h-11 flex-1 rounded-lg px-2 text-[13px]"
              style={{ backgroundColor: inputFill, color: t.ink }}
            />
            {dialUrl(p.number) ? (
              <Pressable
                onPress={() => Linking.openURL(dialUrl(p.number) as string)}
                accessibilityRole="button"
                accessibilityLabel="Позвонить"
                className="h-11 w-11 items-center justify-center rounded-lg active:opacity-70"
                style={{ backgroundColor: `${t.success}1a` }}
              >
                <PhoneIcon color={t.success} size={13} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => removeExtra(p.id)}
              accessibilityRole="button"
              accessibilityLabel="Удалить номер"
              className="h-11 w-11 items-center justify-center rounded-lg active:opacity-60"
            >
              <X color={t.faint} size={13} />
            </Pressable>
          </View>
        ))}

        {hidePhones ? null : (
        <Pressable
          onPress={addExtra}
          accessibilityRole="button"
          accessibilityLabel="Добавить дополнительный номер"
          className="min-h-11 flex-row items-center gap-1 self-start px-1 active:opacity-70"
        >
          <Text
            className="text-[12px] font-semibold"
            style={{ color: t.accent }}
          >
            Добавить номер
          </Text>
        </Pressable>
        )}

        {/* Messengers */}
        <View
          className="gap-2 pt-3"
          style={{ borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <Messenger
            label="Telegram"
            placeholder="@username"
            value={client.telegram_username}
            onChange={(v) => update({ telegram_username: v })}
            url={telegramUrl(tg, client.phone)}
            icon={<Send color={MOBILE_CHANNEL_COLORS.telegram} size={13} />}
            tintColor={MOBILE_CHANNEL_COLORS.telegram}
            t={t}
            inputFill={inputFill}
          />
          <Messenger
            label="Instagram"
            placeholder="@username"
            value={client.instagram_username}
            onChange={(v) => update({ instagram_username: v })}
            url={instagramUrl(ig)}
            icon={
              <Instagram color={MOBILE_CHANNEL_COLORS.instagram} size={13} />
            }
            tintColor={MOBILE_CHANNEL_COLORS.instagram}
            t={t}
            inputFill={inputFill}
          />
          <Messenger
            label="WhatsApp"
            placeholder="отдельный номер для WA"
            value={client.whatsapp_phone}
            onChange={(v) => update({ whatsapp_phone: v })}
            url={
              waDigits
                ? whatsappUrl(client.whatsapp_phone)
                : whatsappUrl(client.phone)
            }
            icon={
              <PhoneIcon color={MOBILE_CHANNEL_COLORS.whatsapp} size={13} />
            }
            tintColor={MOBILE_CHANNEL_COLORS.whatsapp}
            t={t}
            inputFill={inputFill}
          />
        </View>
      </View>
    </CollapsibleCard>
  );
}

function Messenger({
  label,
  placeholder,
  value,
  onChange,
  url,
  icon,
  tintColor,
  t,
  inputFill,
}: {
  label: string;
  placeholder: string;
  value: string;
  /** Fires on blur with the trimmed draft (not per keystroke). */
  onChange: (v: string) => void;
  url: string | null;
  icon: React.ReactNode;
  tintColor: string;
  t: ReturnType<typeof useThemeColors>;
  inputFill: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View
        className="h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: `${tintColor}1a` }}
      >
        {icon}
      </View>
      <DraftInput
        value={value}
        onCommit={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance="light"
        autoCapitalize="none"
        accessibilityLabel={label}
        className="h-11 flex-1 rounded-lg px-3 text-[13px]"
        style={{ backgroundColor: inputFill, color: t.ink }}
      />
      {url ? (
        <Pressable
          onPress={() => Linking.openURL(url)}
          accessibilityRole="link"
          accessibilityLabel={`Открыть ${label}`}
          className="h-11 justify-center rounded-lg px-3 active:opacity-70"
          style={{ borderWidth: 1, borderColor: t.separator }}
        >
          <Text
            className="text-[12px] font-semibold"
            style={{ color: t.accent }}
          >
            Открыть
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
