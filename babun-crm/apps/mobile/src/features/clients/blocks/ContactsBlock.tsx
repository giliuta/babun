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
import {
  Instagram,
  Phone as PhoneIcon,
  Plus,
  Send,
  X,
} from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import { CHANNEL_COLORS } from "@babun/shared/local/chats";
import {
  instagramUrl,
  telegramUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { useThemeColors } from "@/theme/colors";

interface ContactsBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
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
      value={draft}
      onChangeText={setDraft}
      onBlur={() => {
        if (draft.trim() !== value) onCommit(draft.trim());
      }}
      {...rest}
    />
  );
}

export default function ContactsBlock({ client, update }: ContactsBlockProps) {
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
  const summary = client.phone
    ? `${client.phone}${extras.length ? ` · ещё ${extras.length}` : ""}`
    : extras.length
      ? `ещё ${extras.length}`
      : "";

  return (
    <CollapsibleCard title="Контакты" summary={summary}>
      <View className="gap-3 px-1 pt-1">
        {/* Primary phone */}
        <View className="flex-row items-center gap-2">
          <Text className="w-28 shrink-0 text-xs" style={{ color: t.sub }}>
            Основной телефон
          </Text>
          <DraftInput
            value={client.phone}
            onCommit={(v) => update({ phone: v })}
            placeholder="+357 99 ..."
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            keyboardType="phone-pad"
            className="h-8 flex-1 rounded-md px-2 text-[13px]"
            style={{ backgroundColor: inputFill, color: t.ink }}
          />
          {dialUrl(client.phone) ? (
            <Pressable
              onPress={() => Linking.openURL(dialUrl(client.phone) as string)}
              className="h-8 w-8 items-center justify-center rounded-md active:opacity-70"
              style={{ backgroundColor: `${t.success}1a` }}
            >
              <PhoneIcon color={t.success} size={14} />
            </Pressable>
          ) : null}
        </View>

        {/* Extra phones (wife / work / WhatsApp on a different number) */}
        {extras.map((p) => (
          <View key={p.id} className="flex-row items-center gap-2">
            <DraftInput
              value={p.name ?? ""}
              onCommit={(v) => updateExtra(p.id, { name: v })}
              placeholder="Жена"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              className="h-8 w-20 rounded-md px-2 text-[12px]"
              style={{ backgroundColor: inputFill, color: t.ink }}
            />
            <DraftInput
              value={p.number}
              onCommit={(v) => updateExtra(p.id, { number: v })}
              placeholder="+357 ..."
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              keyboardType="phone-pad"
              className="h-8 flex-1 rounded-md px-2 text-[13px]"
              style={{ backgroundColor: inputFill, color: t.ink }}
            />
            {dialUrl(p.number) ? (
              <Pressable
                onPress={() => Linking.openURL(dialUrl(p.number) as string)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Позвонить"
                className="h-7 w-7 items-center justify-center rounded-md active:opacity-70"
                style={{ backgroundColor: `${t.success}1a` }}
              >
                <PhoneIcon color={t.success} size={13} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => removeExtra(p.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Удалить номер"
              className="h-7 w-7 items-center justify-center rounded-md active:opacity-60"
            >
              <X color={t.faint} size={13} />
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={addExtra}
          className="flex-row items-center gap-1 self-start active:opacity-70"
        >
          <Plus color={t.accent} size={13} />
          <Text className="text-[12px] font-semibold" style={{ color: t.accent }}>
            Добавить номер
          </Text>
        </Pressable>

        {/* Messengers */}
        <View className="gap-2 pt-3" style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
          <Messenger
            label="Telegram"
            placeholder="@username"
            value={client.telegram_username}
            onChange={(v) => update({ telegram_username: v })}
            url={telegramUrl(tg, client.phone)}
            icon={<Send color={CHANNEL_COLORS.telegram} size={13} />}
            tintColor={CHANNEL_COLORS.telegram}
            t={t}
            inputFill={inputFill}
          />
          <Messenger
            label="Instagram"
            placeholder="@username"
            value={client.instagram_username}
            onChange={(v) => update({ instagram_username: v })}
            url={instagramUrl(ig)}
            icon={<Instagram color={CHANNEL_COLORS.instagram} size={13} />}
            tintColor={CHANNEL_COLORS.instagram}
            t={t}
            inputFill={inputFill}
          />
          <Messenger
            label="WhatsApp"
            placeholder="отдельный номер для WA"
            value={client.whatsapp_phone}
            onChange={(v) => update({ whatsapp_phone: v })}
            url={
              waDigits ? whatsappUrl(client.whatsapp_phone) : whatsappUrl(client.phone)
            }
            icon={<PhoneIcon color={CHANNEL_COLORS.whatsapp} size={13} />}
            tintColor={CHANNEL_COLORS.whatsapp}
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
        keyboardAppearance={t.dark ? "dark" : "light"}
        autoCapitalize="none"
        className="h-8 flex-1 rounded-md px-2 text-[13px]"
        style={{ backgroundColor: inputFill, color: t.ink }}
      />
      {url ? (
        <Pressable
          onPress={() => Linking.openURL(url)}
          accessibilityLabel={`Открыть ${label}`}
          className="h-7 justify-center rounded-md px-2.5 active:opacity-70"
          style={{ borderWidth: 1, borderColor: t.separator }}
        >
          <Text className="text-[12px] font-semibold" style={{ color: t.accent }}>Открыть</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
