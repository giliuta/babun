// card-actions — the always-visible quick actions of the client card
// (mobile port of apps/web/src/components/clients/ClientQuickActions.tsx,
// visual language from the LOCKED client-app.html mockup «qa» row):
//
//   Звонок · [Записать ·] WhatsApp · Напомнить
//
// «БЕЗ ДУБЛЕЙ» (решение владельца 2026-07-14): каждое действие живёт ровно
// в одном месте. Звонок ушёл из шапки карточки сюда (SMS — не отдельная
// кнопка ряда, а «SMS о долге» внутри «Напомнить»); «Записать» —
// это синий hero (ClientNextJob), поэтому здесь оно появляется ТОЛЬКО
// когда hero занят предстоящей записью и сам на создание не ведёт
// (heroOffersBooking — единственный источник правды). Раньше «Записать»
// было в hero И в ряду, звонок — в шапке И в ряду: девять контролов на
// пять намерений.
//
// Color budget: neutral circles; green ONLY on the comms that dial out
// (Звонок, WhatsApp). Disabled-not-hidden (no phone → dimmed) so the row
// never reflows. «Записать» opens the calendar pre-aimed via card-booking;
// «Напомнить» sets client.reminder_at through quick presets (web uses a
// native date input — RN has no such input, presets keep it 2 taps).
//
// Цепочки (стандарт «минимум тапов»):
// · «Напомнить» у должника — первым пунктом «SMS о долге €X» (sms: с
//   готовым текстом), затем обычные пресеты напоминания себе. Долг
//   считается как в списке: stats.debt, иначе
//   отрицательный balance.

import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { Bell, Calendar, MessageCircle, Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  telUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  renderDebtSms,
  useSmsTemplates,
} from "@/features/settings/sms-templates";
import { useBookingNav } from "@/features/clients/card-booking";
import { heroOffersBooking } from "@/features/clients/ClientNextJob";
import { formatShortDateRu, ymdInDays } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";
import { MOBILE_CHANNEL_COLORS } from "@/theme/readable-color";

interface CardActionsProps {
  client: Client;
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => void;
}

export default function CardActions({
  client,
  stats,
  update,
}: CardActionsProps) {
  const t = useThemeColors();
  const book = useBookingNav();
  const { data: smsTemplates = [] } = useSmsTemplates();

  const tel = telUrl(client.phone);
  const wa = whatsappUrl(client.whatsapp_phone || client.phone);
  const phoneDigits = (client.phone ?? "").replace(/\D/g, "");
  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  // Долг — то же правило, что в строке списка (stats.debt, иначе
  // отрицательный баланс).
  const debt =
    (stats?.debt ?? 0) > 0
      ? stats!.debt
      : client.balance < 0
        ? Math.abs(client.balance)
        : 0;

  const onBook = () =>
    book({
      clientId: client.id,
      locationId: primaryLocationId,
      teamId: stats?.lastTeamId ?? null,
    });

  // Готовое SMS о долге: sms: с body (iOS — «&body», Android — «?body»).
  const debtSmsUrl = (() => {
    if (debt <= 0 || !phoneDigits) return null;
    const first = (client.full_name || "").trim().split(/\s+/)[0] ?? "";
    const body = renderDebtSms(smsTemplates, {
      amount: formatEUR(debt),
      name: first,
    });
    const sep = Platform.OS === "ios" ? "&" : "?";
    return `sms:${phoneDigits}${sep}body=${encodeURIComponent(body)}`;
  })();

  const onRemind = () => {
    const messageParts = [
      debt > 0 ? `Долг ${formatEUR(debt)}` : null,
      client.reminder_at
        ? `Напоминание стоит на ${formatShortDateRu(client.reminder_at) || client.reminder_at}`
        : null,
    ].filter(Boolean) as string[];
    Alert.alert(
      "Напомнить о клиенте",
      messageParts.length > 0 ? messageParts.join(" · ") : undefined,
      [
        // Должнику — напомнить ЕМУ готовым SMS.
        ...(debtSmsUrl
          ? [
              {
                text: `SMS о долге ${formatEUR(debt)}`,
                onPress: () => Linking.openURL(debtSmsUrl),
              },
            ]
          : []),
        // Себе — пресеты reminder_at (2 тапа, web date-input parity).
        {
          text: "Завтра",
          onPress: () => update({ reminder_at: ymdInDays(1) }),
        },
        {
          text: "Через неделю",
          onPress: () => update({ reminder_at: ymdInDays(7) }),
        },
        {
          text: "Через месяц",
          onPress: () => update({ reminder_at: ymdInDays(30) }),
        },
        ...(client.reminder_at
          ? [
              {
                text: "Убрать напоминание",
                style: "destructive" as const,
                onPress: () => update({ reminder_at: null }),
              },
            ]
          : []),
        { text: "Отмена", style: "cancel" as const },
      ],
    );
  };

  // Hero сам зовёт на создание записи во всех режимах кроме «есть
  // предстоящая запись» — там он показывает ЕЁ и ведёт на дату. Только в
  // этом случае «Записать» нужно здесь, иначе клиенту с записью новую
  // было бы не создать с карточки.
  const showBook = !heroOffersBooking(stats);

  return (
    <View className="mx-3 mb-1 mt-3 flex-row items-start justify-between px-1">
      <Action
        label="Звонок"
        icon={
          <Phone color={tel ? t.success : t.faint} size={21} strokeWidth={2} />
        }
        onPress={tel ? () => Linking.openURL(tel) : undefined}
      />
      {showBook ? (
        <Action
          label="Записать"
          icon={<Calendar color={t.ink} size={21} strokeWidth={2} />}
          onPress={onBook}
        />
      ) : null}
      <Action
        label="WhatsApp"
        icon={
          <MessageCircle
            color={wa ? MOBILE_CHANNEL_COLORS.whatsapp : t.faint}
            size={21}
            strokeWidth={2}
          />
        }
        onPress={wa ? () => Linking.openURL(wa) : undefined}
      />
      <Action
        label="Напомнить"
        icon={<Bell color={t.ink} size={21} strokeWidth={2} />}
        onPress={onRemind}
      />
    </View>
  );
}

function Action({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const enabled = !!onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      className={`items-center gap-1.5 active:opacity-70 ${enabled ? "" : "opacity-40"}`}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: t.fill }}
      >
        {icon}
      </View>
      <Text className="text-[11px]" style={{ color: t.sub }}>
        {label}
      </Text>
    </Pressable>
  );
}
