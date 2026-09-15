import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Building2,
  CalendarRange,
  Mail,
} from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { Spinner } from "@/components/ui/Spinner";
import { useSession } from "@/providers/SessionProvider";
import { signOutAndWipe } from "@/lib/auth-clear";
import {
  acceptAndActivateInvitation,
  useInvitationPreview,
} from "@/features/settings/invitations";
import {
  clearPendingInvitationToken,
  rememberPendingInvitationToken,
} from "@/features/settings/pending-invitation";
import {
  InvitationGoneError,
  invitationErrorMessage,
  isInvitationToken,
} from "@/features/settings/invitation-flow";

// ПРИГЛАШЕНИЕ ПО ССЫЛКЕ.
//
// ОДНА КНОПКА — ВНИЗУ, В КАРТОЧКАХ ТОЛЬКО СЛОВА (владелец 15.09 на «Повторить»
// внутри карточки: «почему кнопка не внизу — почему она не соблюдает нашу
// архитектуру»). Действие экрана одно и живёт в футере, как у всех экранов;
// вторая кнопка появляется под первой только там, где у человека правда два
// пути (войти или создать аккаунт).
//
// ПРИГЛАШЕНИЯ БОЛЬШЕ НЕТ — ССЫЛКА ЗАБЫВАЕТСЯ (владелец 15.09: «вечная хуета
// открывается»). Токен запоминается, чтобы после входа вернуть человека сюда
// (`(auth)/_layout.tsx`), и раньше стирался только при истёкшем сроке:
// отозванное или удалённое приглашение возвращало этот экран при каждом входе.
// Теперь ссылка забывается, как только сервер ответил «такого нет», и когда
// человек сам уходит с экрана. Обрыв связи ссылку не трогает — это не ответ.

export default function InvitationScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = isInvitationToken(rawToken) ? rawToken : null;
  const preview = useInvitationPreview(token);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const gone = preview.error instanceof InvitationGoneError;
  const expired = preview.data?.state === "expired";

  useEffect(() => {
    if (token) void rememberPendingInvitationToken(token);
  }, [token]);

  useEffect(() => {
    if (token && (gone || expired)) void clearPendingInvitationToken(token);
  }, [gone, expired, token]);

  const expiry = useMemo(() => {
    if (!preview.data?.expiresAt) return "";
    const date = new Date(preview.data.expiresAt);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }, [preview.data?.expiresAt]);

  const goToAuth = async (path: "/login" | "/register") => {
    if (!token) return;
    await rememberPendingInvitationToken(token);
    router.push(path);
  };

  const accept = async () => {
    if (!token || !session || working) return;
    setActionError(null);
    setWorking(true);
    try {
      await acceptAndActivateInvitation(token, preview.data?.role);
      router.replace("/");
    } catch (error) {
      setActionError(invitationErrorMessage((error as Error).message));
      setWorking(false);
    }
  };

  // Ушёл с экрана сам — ссылка больше не возвращает его сюда при каждом входе.
  const goBack = () => {
    if (token) void clearPendingInvitationToken(token);
    if (session) router.replace("/");
    else router.replace("/login");
  };

  const ready = !!token && !!preview.data && !expired;

  let content: ReactNode;
  let footer: ReactNode = null;
  if (!token) {
    content = (
      <MessageCard
        title="Ссылка повреждена"
        text="Попросите владельца компании отправить новое приглашение."
      />
    );
    footer = <GradientButton label="Готово" onPress={goBack} />;
  } else if (preview.isLoading) {
    content = (
      <View className="items-center px-6 py-20">
        <Spinner size={28} label="Проверяем приглашение" />
        <Text style={{ marginTop: 12, fontSize: 14, color: t.sub }}>
          Проверяем приглашение…
        </Text>
      </View>
    );
  } else if (gone) {
    content = (
      <MessageCard
        title="Приглашения больше нет"
        text="Попросите владельца отправить новое приглашение."
      />
    );
    footer = <GradientButton label="Готово" onPress={goBack} />;
  } else if (preview.isError || !preview.data) {
    content = (
      <MessageCard title="Нет связи" text="Проверьте интернет и повторите." />
    );
    footer = (
      <GradientButton label="Повторить" onPress={() => void preview.refetch()} />
    );
  } else {
    content = (
      <>
        <View className="items-center px-6 pb-5">
          <View
            className="h-16 w-16 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: t.fill }}
          >
            <Building2 color={t.accent} size={30} />
          </View>
          <Text
            style={{
              marginTop: 14,
              textAlign: "center",
              fontSize: 24,
              fontWeight: "700",
              color: t.ink,
            }}
          >
            {preview.data.tenantName}
          </Text>
          <Text
            style={{
              marginTop: 5,
              textAlign: "center",
              fontSize: 14,
              lineHeight: 20,
              color: t.sub,
            }}
          >
            Владелец приглашает вас работать в этой компании.
          </Text>
        </View>

        <SectionCard>
          {/* Роль не показываем (владелец 15.09: «роль уберём, она в
              целом нам не нужна»): человек видит, куда его зовут. */}
          {preview.data.teamName ? (
            <>
              <InfoRow
                icon={<CalendarRange color={t.accent} size={ICON.sm} />}
                label="Календарь"
                value={preview.data.teamName}
              />
              <Divider inset={52} />
            </>
          ) : null}
          <InfoRow
            icon={<Mail color={t.accent} size={ICON.sm} />}
            label="Аккаунт"
            value={preview.data.emailHint}
          />
        </SectionCard>

        {expired ? (
          <MessageCard
            title="Срок приглашения истёк"
            text="Попросите владельца отправить новое приглашение."
          />
        ) : (
          <View className="px-4 pt-6">
            <Text
              style={{
                textAlign: "center",
                fontSize: 13,
                lineHeight: 18,
                color: t.sub,
              }}
            >
              {session
                ? `Вы вошли как ${session.user.email ?? "пользователь Babun"}`
                : "Войдите под указанным email. После входа Babun вернёт вас на эту страницу."}
            </Text>
            {actionError ? (
              <Text
                accessibilityRole="alert"
                style={{
                  marginTop: 12,
                  textAlign: "center",
                  fontSize: 13,
                  lineHeight: 18,
                  color: t.danger,
                }}
              >
                {actionError}
              </Text>
            ) : null}
            {expiry ? (
              <Text
                style={{
                  marginTop: 12,
                  textAlign: "center",
                  fontSize: 12,
                  color: t.faint,
                }}
              >
                Ссылка действует до {expiry}
              </Text>
            ) : null}
          </View>
        )}
      </>
    );
    if (expired) {
      footer = <GradientButton label="Готово" onPress={goBack} />;
    } else if (ready && session) {
      footer = (
        <>
          <GradientButton
            label={working ? "Подключаем компанию…" : "Принять приглашение"}
            onPress={() => void accept()}
            loading={working}
            disabled={working}
          />
          {actionError?.includes("другой email") ? (
            <Button
              label="Войти под другим аккаунтом"
              variant="secondary"
              onPress={() => void signOutAndWipe()}
              disabled={working}
            />
          ) : null}
        </>
      );
    } else if (ready) {
      footer = (
        <>
          <GradientButton label="Войти и принять" onPress={() => void goToAuth("/login")} />
          <Button
            label="Создать аккаунт"
            variant="secondary"
            onPress={() => void goToAuth("/register")}
          />
        </>
      );
    }
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <ScreenHeader title="Приглашение в CRM" onBack={goBack} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {content}
      </ScrollView>
      {footer ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 8 }}>
          {footer}
        </View>
      ) : null}
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  const t = useThemeColors();
  return (
    <View className="min-h-[58px] flex-row items-center gap-3 px-4 py-2.5">
      <View className="w-6 items-center">{icon}</View>
      <Text style={{ flex: 1, fontSize: 15, color: t.ink }}>{label}</Text>
      <Text
        style={{ maxWidth: "55%", fontSize: 14, color: t.sub }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** Сообщение экрана — только слова. Действие у экрана одно и живёт в футере. */
function MessageCard({ title, text }: { title: string; text: string }) {
  const t = useThemeColors();
  return (
    <SectionCard padded className="mt-4">
      <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
        {title}
      </Text>
      <Text
        style={{ marginTop: 5, fontSize: 14, lineHeight: 20, color: t.sub }}
      >
        {text}
      </Text>
    </SectionCard>
  );
}
