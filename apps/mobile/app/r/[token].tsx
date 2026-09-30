import { useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleCheck, CircleX, Clock, MapPin, Wrench, type LucideIcon } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import {
  dayWords,
  isAppointmentLinkToken,
  linkTitle,
  type AppointmentLinkInfo,
} from "@/features/sms/appointment-link";
import {
  answerAppointmentLink,
  appointmentLinkKey,
  useAppointmentLinkLookup,
} from "@/features/sms/appointment-link-public";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// «ПОДТВЕРДИТЬ / ОТМЕНИТЬ» — СТРАНИЦА ЗАПИСИ ДЛЯ КЛИЕНТА (STORY-089,
// волна 7). Кипрские номера ответных SMS не принимают, поэтому в SMS — поле
// [Ссылка]: babun.app/r/<токен>. Клиент без входа видит свою запись (день,
// время, услуги, адрес) и отвечает одним тапом:
//   • «Подтверждаю» — отметка в блоке SMS записи у мастера;
//   • «Отменить запись» — спрашивает «Точно отменить?» здесь же, вторым
//     тапом; запись становится «Отменена», дальше — обычная цепочка отмены.
// Состояние после ответа приходит от базы: страница показывает его, а не
// своё предположение (ссылку могли открыть в двух вкладках).

export default function AppointmentLinkScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = isAppointmentLinkToken(raw) ? raw : null;
  const lookup = useAppointmentLinkLookup(token);
  const info = lookup.data;
  const business = info?.businessName ?? "";

  let body: ReactNode;
  if (!token) {
    body = <Message title="Ссылка не найдена" text="Попросите новую ссылку у того, кто её прислал." />;
  } else if (lookup.isLoading) {
    body = (
      <View style={{ alignItems: "center", paddingVertical: 80 }}>
        <Spinner size={28} label="Открываем запись" />
      </View>
    );
  } else if (lookup.isError || !info) {
    body = (
      <Message
        title="Не удалось открыть запись"
        text={lookup.error instanceof Error ? lookup.error.message : "Проверьте интернет и повторите."}
        action={{ label: "Повторить", onPress: () => void lookup.refetch() }}
      />
    );
  } else if (info.state === "missing") {
    body = (
      <Message
        title="Ссылка не найдена"
        text={`Попросите новую ссылку${business ? ` у ${business}` : ""}.`}
      />
    );
  } else {
    body = <Appointment token={token} info={info} />;
  }

  return (
    <Screen edges={["top", "bottom"]}>
      {Platform.OS === "web" ? (
        <Head>
          <title>{`Ваша запись${business ? ` · ${business}` : ""}`}</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 48 }}>
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>
          {info && (info.businessName || info.logoUrl) ? <Business info={info} /> : null}
          {body}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Business({ info }: { info: AppointmentLinkInfo }) {
  const t = useThemeColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
      {info.logoUrl ? (
        <Image
          source={{ uri: info.logoUrl }}
          accessibilityIgnoresInvertColors
          style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: t.fill }}
        />
      ) : (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${t.accent}14`,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.accent }}>
            {info.businessName.trim().charAt(0).toUpperCase() || "•"}
          </Text>
        </View>
      )}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: "700", color: t.ink }}>
        {info.businessName}
      </Text>
    </View>
  );
}

// ─── Запись и ответ ─────────────────────────────────────────────────────────

function Appointment({ token, info }: { token: string; info: AppointmentLinkInfo }) {
  const t = useThemeColors();
  const qc = useQueryClient();
  const [sending, setSending] = useState<"confirmed" | "cancelled" | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (value: "confirmed" | "cancelled") => {
    if (sending) return;
    setError(null);
    setSending(value);
    try {
      const next = await answerAppointmentLink(token, value);
      qc.setQueryData(appointmentLinkKey(token), next);
      setAsking(false);
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Не удалось отправить. Повторите.");
    } finally {
      setSending(null);
    }
  };

  const open = info.state === "pending" || info.state === "confirmed";
  const status =
    info.state === "confirmed"
      ? { icon: CircleCheck, color: t.success }
      : info.state === "cancelled"
        ? { icon: CircleX, color: t.danger }
        : null;
  const day = dayWords(info.date);
  const rows: { icon: LucideIcon; text: string }[] = [
    ...(day ? [{ icon: CalendarDays, text: day }] : []),
    ...(info.time ? [{ icon: Clock, text: info.time }] : []),
    ...(info.services.length ? [{ icon: Wrench, text: info.services.join(", ") }] : []),
    ...(info.address ? [{ icon: MapPin, text: info.address }] : []),
  ];

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        {status ? (
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
              backgroundColor: `${status.color}14`,
            }}
          >
            <status.icon color={status.color} size={30} />
          </View>
        ) : null}
        <Text
          accessibilityRole="header"
          style={{ fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.4, color: t.ink }}
        >
          {linkTitle(info)}
        </Text>
        {info.state === "cancelled" ? (
          <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 21, color: t.sub }}>
            {`Если это ошибка — позвоните${info.businessName ? ` в ${info.businessName}` : ""}.`}
          </Text>
        ) : null}
      </View>

      {rows.length > 0 ? (
        <SectionCard className="mt-4">
          {rows.map((row, index) => (
            <View key={row.text}>
              {index > 0 ? <Divider inset={48} /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 52, paddingVertical: 12 }}>
                <row.icon color={t.sub} size={20} strokeWidth={2} />
                <Text selectable style={{ flex: 1, fontSize: 16, lineHeight: 22, color: t.ink }}>
                  {row.text}
                </Text>
              </View>
            </View>
          ))}
        </SectionCard>
      ) : null}

      {open ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 12 }}>
          {error ? <NoticeBar tone="error" message={error} /> : null}
          {info.state === "pending" ? (
            <Button
              label={sending === "confirmed" ? "Отправляем…" : "Подтверждаю"}
              onPress={() => void answer("confirmed")}
              disabled={!!sending}
              loading={sending === "confirmed"}
            />
          ) : null}
          {asking ? (
            <View
              style={{
                padding: 16,
                gap: 12,
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: `${t.danger}0F`,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>Точно отменить запись?</Text>
              <Button
                label={sending === "cancelled" ? "Отменяем…" : "Да, отменить"}
                variant="filled"
                tone="danger"
                onPress={() => void answer("cancelled")}
                disabled={!!sending}
                loading={sending === "cancelled"}
              />
              <Pressable
                onPress={() => setAsking(false)}
                accessibilityRole="button"
                style={({ pressed }) => ({ alignItems: "center", paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Нет, оставить</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setAsking(true)}
              disabled={!!sending}
              accessibilityRole="button"
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: t.danger }}>Отменить запись</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </>
  );
}

function Message({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useThemeColors();
  return (
    <SectionCard padded className="mt-4">
      <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>{title}</Text>
      <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 20, color: t.sub }}>{text}</Text>
      {action ? (
        <View className="mt-4">
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </SectionCard>
  );
}
