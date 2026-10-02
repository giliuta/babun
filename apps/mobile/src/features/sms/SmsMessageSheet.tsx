import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { CalendarDays, User } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useToast } from "@/components/ui/Toast";
import { usePlanAllows } from "@/features/settings/tenant";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import { notify } from "@/lib/notify";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useThemeColors } from "@/theme/colors";
import { smsErrorText, useSendSmsViaService } from "./sms-account";
import { bucketOf } from "./sms-history-view";
import type { SmsHistoryItem } from "./sms-model";
import { when } from "./SmsHistoryRow";
import { costWords, statusWords, triggerWords } from "./sms-words";

// СООБЩЕНИЕ ЦЕЛИКОМ (STORY-089, страница истории). Тап по строке истории:
// текст пузырём — как его увидел клиент, дальше факты строками (итог, повод,
// когда, команда, номер, части, цена) и двери к клиенту и записи. Действие
// листа одно и только у недошедшего — «Отправить ещё раз» (тем же текстом,
// через сервис).

/** Факт строкой «ярлык — значение»: без значка, от левого края карточки. */
function Fact({ title, value, color }: { title: string; value: string; color?: string }) {
  const t = useThemeColors();
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${value}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 10 }}
    >
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, fontSize: 16, color: t.ink }}>
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 16, fontWeight: "600", color: color ?? t.ink, fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

export function SmsMessageSheet({
  item,
  teamName,
  onClose,
}: {
  /** Открытое сообщение; `null` — лист закрыт. */
  item: SmsHistoryItem | null;
  teamName: (teamId: string | null) => string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const send = useSendSmsViaService();
  const country = useDefaultCountry(item?.teamId ?? null);
  const smsInPlan = usePlanAllows("sms");
  // Закрытый лист дорисовывает последнее сообщение, пока уезжает вниз.
  const [shown, setShown] = useState<SmsHistoryItem | null>(item);
  if (item && item !== shown) setShown(item);
  const m = item ?? shown;
  if (!m) return null;

  const bucket = bucketOf(m.status);
  const color = bucket === "failed" ? t.danger : bucket === "delivered" ? t.success : t.warning;
  const waits = m.status === "queued" && m.sendAfter && new Date(m.sendAfter).getTime() > Date.now();
  const status = waits && m.sendAfter ? `Уйдёт ${when(m.sendAfter)}` : statusWords(m.status);
  const text = m.body ?? m.templateBody ?? "";
  const cost = costWords(m);
  const team = teamName(m.teamId);
  const canResend = bucket === "failed" && !!m.body && !!m.clientId;

  const go = (href: Href) => {
    onClose();
    setTimeout(() => router.push(href), SHEET_EXIT_MS);
  };

  const resend = () => {
    onClose();
    send.mutate(
      { appointmentId: m.appointmentId, clientId: m.clientId, body: m.body ?? "" },
      {
        onSuccess: () => toast("SMS отправляется", "success"),
        onError: (e) => notify("SMS не отправлена", smsErrorText(e)),
      },
    );
  };

  return (
    <BottomSheet
      visible={!!item}
      onClose={onClose}
      title={m.clientName ?? (m.toPhone || "SMS")}
      subtitle={triggerWords(m.trigger)}
      scroll
      footer={
        canResend ? (
          <TariffLocked locked={!smsInPlan} beforeNudge={onClose}>
            <Button label="Отправить ещё раз" onPress={resend} />
          </TariffLocked>
        ) : undefined
      }
    >
      {text ? (
        <View
          style={{
            alignSelf: "flex-end",
            maxWidth: "88%",
            marginBottom: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 18,
            borderBottomRightRadius: 6,
            borderCurve: "continuous",
            backgroundColor: t.accent,
          }}
        >
          <Text selectable maxFontSizeMultiplier={1.3} style={{ fontSize: 16, lineHeight: 22, color: "#ffffff" }}>
            {text}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          marginBottom: 12,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
          backgroundColor: t.rowFill,
          overflow: "hidden",
        }}
      >
        <Fact title="Итог" value={status} color={color} />
        {bucket === "failed" && m.error ? (
          <Text maxFontSizeMultiplier={1.3} style={{ paddingHorizontal: 16, paddingBottom: 12, fontSize: 14, color: t.danger }}>
            {m.error}
          </Text>
        ) : null}
        <Divider inset={16} />
        <Fact title="Создано" value={when(m.createdAt)} />
        {team ? (
          <>
            <Divider inset={16} />
            <Fact title="Команда" value={team} />
          </>
        ) : null}
        {/* Сотруднику сервер номер не отдаёт (номера — по одному, из карточки):
            пустой строки «Номер» не рисуем. */}
        {m.toPhone ? (
          <>
            <Divider inset={16} />
            <Fact title="Номер" value={formatPhoneForDisplay(m.toPhone, country)} />
          </>
        ) : null}
        {m.segments ? (
          <>
            <Divider inset={16} />
            <Fact title="Частей" value={String(m.segments)} />
          </>
        ) : null}
        {cost ? (
          <>
            <Divider inset={16} />
            <Fact title="Стоимость" value={cost} />
          </>
        ) : null}
      </View>

      {m.clientId || m.appointmentId ? (
        <View
          style={{
            marginBottom: 8,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            backgroundColor: t.rowFill,
            overflow: "hidden",
          }}
        >
          {m.clientId ? (
            <SettingsRow
              tile="neutral"
              icon={User}
              title="Клиент"
              sub={m.clientName ?? undefined}
              onPress={() => go(`/clients/${m.clientId}` as Href)}
            />
          ) : null}
          {m.clientId && m.appointmentId ? <Divider inset={48} /> : null}
          {m.appointmentId ? (
            <SettingsRow
              tile="neutral"
              icon={CalendarDays}
              title="Запись"
              onPress={() => go({ pathname: "/book", params: { appointmentId: m.appointmentId } } as unknown as Href)}
            />
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
