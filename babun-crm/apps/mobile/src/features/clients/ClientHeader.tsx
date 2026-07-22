// Mobile port of apps/web/src/components/clients/ClientHeader.tsx (web v813).
//
// ЕДИНАЯ КАРТОЧКА-ИДЕНТИЧНОСТЬ — одна вёрстка на оба режима экрана клиента
// (решение владельца 2026-07-14 «одна страница на создание и просмотр»):
// имя (заголовок) + флаг/телефон, ниже долг · напоминание · строка доверия.
// В ЧЕРНОВИКЕ те же поля просто пустые — карточка не подменяется формой:
// телефон с автофокусом и живой валидацией (`draft.valid` → ✓), бейджи
// уступают свой слот кнопке «Из контактов», под номером — слот дедупа
// (`draft.footer`). Долг/напоминание/доверие в черновике пусты сами по
// себе (stats пустой), так что ветвлений на них не нужно.
//
// ЗВОНКА/SMS В ШАПКЕ НЕТ (было: и здесь, и в hero, и в ряду — девять
// контролов на пять намерений). Каждое действие живёт ровно в одном
// месте: hero «Записать» + ряд card-actions.
//
// Presentational. Правки имени/телефона персистит через `update`; телефон
// сохраняется ВМЕСТЕ с производным phone_e164 — иначе ключ дедупа
// (findClientByPhoneE164 + DB unique index) остался бы от старого номера.

import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  Ban,
  Bell,
  Cake,
  Calendar,
  Check,
  Contact,
  Sparkles,
  Star,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  formatShortDateRu,
  reminderBadge,
  visitsWord,
} from "@/features/clients/format";
import { countryFlag, phoneCountry, tryToE164 } from "@/features/clients/phone";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";

/** Режим создания: то, что знает только композер экрана.
 *
 *  Имя и телефон здесь редактируются ЖИВО (onChangeText), а не по blur как
 *  в карточке: «Готово» читает черновик из замыкания текущего рендера, и
 *  blur-сохранение не успело бы долететь — клиент создавался бы без только
 *  что набранного имени. В карточке blur безопасен: там update = PATCH. */
export interface ClientHeaderDraft {
  /** Номер уже валиден (E.164) — рисуем ✓ у поля. */
  valid: boolean;
  /** Живой ввод имени (см. коммент выше). */
  onNameChange: (v: string) => void;
  /** Живой ввод номера: AsYouType + сброс дедупа (владеет композер). */
  onPhoneChange: (v: string) => void;
  /** Нативный пикер контакта; undefined на билдах без модуля. */
  onPickContacts?: () => void;
  /** Баннер дедупа / ошибка создания — внутри карточки, под номером. */
  footer?: ReactNode;
}

interface ClientHeaderProps {
  client: Client;
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => void;
  draft?: ClientHeaderDraft;
}

// ─── Status badges (port of ClientStatusBadges, capped at 3) ──────────
const MAX_BADGES = 3;

function StatusBadges({
  client,
  stats,
}: {
  client: Client;
  stats: ClientStats | undefined;
}) {
  const t = useThemeColors();
  type ThemedBadgeSlot = { key: string; Icon: typeof Star; bg: string; color: string };
  const slots: ThemedBadgeSlot[] = [];

  if (client.blacklisted) {
    slots.push({ key: "blacklist", Icon: Ban, bg: `${t.danger}1a`, color: t.danger });
  }
  const bdays = stats?.birthdayInDays ?? null;
  if (bdays !== null && bdays >= 0 && bdays <= 14) {
    slots.push({ key: "birthday", Icon: Cake, bg: `${t.warning}1a`, color: t.warning });
  }
  const naDays = stats?.nextAptDays ?? null;
  if (naDays !== null && naDays >= 0 && naDays <= 7) {
    slots.push({ key: "calendar", Icon: Calendar, bg: `${t.accent}1a`, color: t.accent });
  }
  if (client.tag_ids?.includes("tag-vip")) {
    // VIP = золото лояльности — тот же семантический литерал, что у tier-пилла
    // в FinanceBlock. Тинт под иконку,
    // как у остальных бейджей, а не серый t.fill.
    slots.push({ key: "vip", Icon: Star, bg: `${t.warning}1a`, color: t.warning });
  }
  const isNew =
    stats !== undefined && stats.ageDays >= 0 && stats.ageDays < 30 && stats.visits === 0;
  if (isNew) {
    slots.push({ key: "new", Icon: Sparkles, bg: `${t.success}1a`, color: t.success });
  }

  const visible = slots.slice(0, MAX_BADGES);
  if (visible.length === 0) return null;
  return (
    <View className="flex-row items-center gap-1">
      {visible.map(({ key, Icon, bg, color }) => (
        <View
          key={key}
          className="h-5 w-5 items-center justify-center rounded-full"
          style={{ backgroundColor: bg }}
        >
          <Icon color={color} size={11} strokeWidth={2.5} />
        </View>
      ))}
    </View>
  );
}

// ─── Inline-editable single-line text (tap → edit, save on blur) ──────
function EditableLine({
  value,
  onSave,
  placeholder,
  textClass,
  valueColor,
  keyboardType,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
  textClass: string;
  valueColor?: string;
  keyboardType?: "phone-pad" | "default";
}) {
  const t = useThemeColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (editing) {
    return (
      <TextInput
        autoFocus
        accessibilityLabel={placeholder}
        value={draft}
        onChangeText={setDraft}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance="light"
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== value) onSave(draft.trim());
        }}
        className={`rounded-lg px-2 py-1 ${textClass}`}
        style={{ minHeight: 44, backgroundColor: t.fill, color: t.ink }}
      />
    );
  }
  return (
    <Pressable
      onPress={() => setEditing(true)}
      accessibilityRole="button"
      accessibilityLabel={value ? `${placeholder}: ${value}` : placeholder}
      accessibilityHint="Нажмите, чтобы изменить"
      hitSlop={{ top: 8, bottom: 8 }}
      className="active:opacity-60"
    >
      <Text style={{ color: value ? (valueColor ?? t.ink) : t.faint }} className={textClass}>
        {value || placeholder}
      </Text>
    </Pressable>
  );
}

export default function ClientHeader({ client, stats, update, draft }: ClientHeaderProps) {
  const t = useThemeColors();
  const country = phoneCountry(client.phone);

  const debt = stats && stats.debt > 0 ? `Долг ${formatEUR(stats.debt)}` : null;
  // «Напомнить» (card-actions) пишет reminder_at — строка делает дату
  // видимой: серая, когда впереди, красная — сегодня/прошло. Тот же
  // reminderBadge, что у колокольчика в списке клиентов.
  const badge = reminderBadge(client.reminder_at);
  const reminder = badge
    ? { text: `Напомнить · ${badge.label}`, due: badge.due }
    : null;
  const trustSegments = (
    stats
      ? [
          stats.visits > 0 ? `${stats.visits} ${visitsWord(stats.visits)}` : null,
          stats.totalSpent > 0 ? formatEUR(stats.totalSpent) : null,
          stats.lastVisitDate ? `был ${formatShortDateRu(stats.lastVisitDate)}` : null,
        ].filter(Boolean)
      : []
  ) as string[];

  return (
    <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
      {/* Имя (заголовок) + бейджи · в черновике — «Из контактов» */}
      <View className="flex-row items-center gap-1.5">
        <View className="flex-1">
          {draft ? (
            <TextInput
              value={client.full_name}
              onChangeText={draft.onNameChange}
              placeholder="Имя"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Имя клиента"
              className="py-1 text-xl font-bold"
              style={{ color: t.ink }}
            />
          ) : (
            <EditableLine
              value={client.full_name}
              onSave={(v) => update({ full_name: v })}
              placeholder="Имя"
              textClass="text-xl font-bold"
              valueColor={t.ink}
            />
          )}
        </View>
        {draft ? (
          draft.onPickContacts ? (
            <Pressable
              onPress={draft.onPickContacts}
              accessibilityRole="button"
              accessibilityLabel="Заполнить из контактов"
              className="min-h-11 flex-row items-center gap-1.5 rounded-full px-3 active:opacity-70"
              style={{ backgroundColor: `${t.accent}14` }}
            >
              <Contact color={t.accent} size={14} strokeWidth={2.2} />
              <Text className="text-[12px] font-semibold" style={{ color: t.accent }}>
                Из контактов
              </Text>
            </Pressable>
          ) : null
        ) : (
          <StatusBadges client={client} stats={stats} />
        )}
      </View>

      {/* Флаг + телефон. Черновик — живой ввод с автофокусом и ✓;
          карточка — тот же вид, редактируется по тапу. */}
      <View className="mt-1 flex-row items-center gap-2">
        {country ? (
          <Text className="text-base" accessibilityLabel={`Страна: ${country}`}>
            {countryFlag(country)}
          </Text>
        ) : null}
        <View className="flex-1">
          {draft ? (
            <TextInput
              value={client.phone}
              onChangeText={draft.onPhoneChange}
              placeholder="Телефон"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType="phone-pad"
              autoFocus
              accessibilityLabel="Телефон клиента"
              className="py-1 text-[15px] font-medium"
              style={{ color: t.body, fontVariant: ["tabular-nums"] }}
            />
          ) : (
            <EditableLine
              value={client.phone}
              onSave={(v) => update({ phone: v, phone_e164: tryToE164(v) })}
              placeholder="Телефон"
              textClass="text-[15px] font-medium"
              valueColor={t.body}
              keyboardType="phone-pad"
            />
          )}
        </View>
        {draft?.valid ? <Check color={t.success} size={18} strokeWidth={2.5} /> : null}
      </View>

      {/* Слот черновика: дедуп «Похоже, такой уже есть» / ошибка создания */}
      {draft?.footer}

      {/* Debt atom (red, only when долг>0) */}
      {debt ? (
        <Text className="mt-1.5 text-sm font-semibold" style={{ color: t.danger }}>{debt}</Text>
      ) : null}

      {/* Reminder atom — grey upcoming, red when due */}
      {reminder ? (
        <View className="mt-1.5 flex-row items-center gap-1">
          <Bell color={reminder.due ? t.danger : t.sub} size={12} strokeWidth={2.2} />
          <Text
            className={`text-[13px] ${reminder.due ? "font-semibold" : ""}`}
            style={{ color: reminder.due ? t.danger : t.sub }}
          >
            {reminder.text}
          </Text>
        </View>
      ) : null}

      {/* Trust line «N визитов · €LTV · был дата» */}
      {trustSegments.length > 0 ? (
        <Text className="mt-1 text-[13px]" style={{ color: t.sub }}>
          {trustSegments.join(" · ")}
        </Text>
      ) : null}
    </Card>
  );
}
