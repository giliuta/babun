import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Building2, Mail, ShieldCheck } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
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
  invitationErrorMessage,
  isInvitationToken,
} from "@/features/settings/invitation-flow";
import { ROLE_LABELS } from "@/features/settings/role-policy";

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

  useEffect(() => {
    if (token) void rememberPendingInvitationToken(token);
  }, [token]);

  useEffect(() => {
    if (token && preview.data?.state === "expired") {
      void clearPendingInvitationToken(token);
    }
  }, [preview.data?.state, token]);

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
      await acceptAndActivateInvitation(token);
      router.replace("/");
    } catch (error) {
      setActionError(invitationErrorMessage((error as Error).message));
      setWorking(false);
    }
  };

  const goBack = () => {
    if (session) router.replace("/");
    else router.replace("/login");
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Приглашение в CRM" onBack={goBack} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {!token ? (
          <MessageCard
            title="Ссылка повреждена"
            text="Попросите владельца компании отправить новое приглашение."
          />
        ) : preview.isLoading ? (
          <View className="items-center px-6 py-20">
            <ActivityIndicator color={t.accent} />
            <Text style={{ marginTop: 12, fontSize: 14, color: t.sub }}>
              Проверяем приглашение…
            </Text>
          </View>
        ) : preview.isError || !preview.data ? (
          <MessageCard
            title="Не удалось открыть приглашение"
            text={
              preview.error instanceof Error
                ? preview.error.message
                : "Проверьте интернет и повторите."
            }
            action={{
              label: "Повторить",
              onPress: () => void preview.refetch(),
            }}
          />
        ) : (
          <>
            <View className="items-center px-6 pb-5">
              <View
                className="h-16 w-16 items-center justify-center rounded-[22px]"
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
              <InfoRow
                icon={<ShieldCheck color={t.accent} size={ICON.sm} />}
                label="Роль"
                value={ROLE_LABELS[preview.data.role]}
              />
              <Divider inset={52} />
              <InfoRow
                icon={<Mail color={t.accent} size={ICON.sm} />}
                label="Аккаунт"
                value={preview.data.emailHint}
              />
            </SectionCard>

            {preview.data.state === "expired" ? (
              <MessageCard
                title="Срок приглашения истёк"
                text="Попросите владельца создать и отправить новую ссылку."
              />
            ) : (
              <View className="px-4 pt-6">
                {session ? (
                  <Text
                    style={{
                      marginBottom: 12,
                      textAlign: "center",
                      fontSize: 13,
                      color: t.sub,
                    }}
                  >
                    Вы вошли как {session.user.email ?? "пользователь Babun"}
                  </Text>
                ) : (
                  <Text
                    style={{
                      marginBottom: 12,
                      textAlign: "center",
                      fontSize: 13,
                      lineHeight: 18,
                      color: t.sub,
                    }}
                  >
                    Войдите под указанным email. После входа Babun вернёт вас
                    на эту страницу.
                  </Text>
                )}

                {actionError ? (
                  <View
                    className="mb-3 rounded-2xl px-4 py-3"
                    style={{
                      backgroundColor: t.surface,
                      borderWidth: 1,
                      borderColor: t.danger,
                    }}
                    accessibilityRole="alert"
                  >
                    <Text
                      style={{
                        textAlign: "center",
                        fontSize: 13,
                        lineHeight: 18,
                        color: t.danger,
                      }}
                    >
                      {actionError}
                    </Text>
                  </View>
                ) : null}

                {session ? (
                  <>
                    <Button
                      label={
                        working
                          ? "Подключаем компанию…"
                          : "Принять приглашение"
                      }
                      onPress={() => void accept()}
                      loading={working}
                      disabled={working}
                    />
                    {actionError?.includes("другой email") ? (
                      <View className="mt-3">
                        <Button
                          label="Войти под другим аккаунтом"
                          variant="secondary"
                          onPress={() => void signOutAndWipe()}
                          disabled={working}
                        />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button
                      label="Войти и принять"
                      onPress={() => void goToAuth("/login")}
                    />
                    <View className="mt-3">
                      <Button
                        label="Создать аккаунт"
                        variant="secondary"
                        onPress={() => void goToAuth("/register")}
                      />
                    </View>
                  </>
                )}

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
        )}
      </ScrollView>
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

function MessageCard({
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
      <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
        {title}
      </Text>
      <Text
        style={{ marginTop: 5, fontSize: 14, lineHeight: 20, color: t.sub }}
      >
        {text}
      </Text>
      {action ? (
        <View className="mt-4">
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </SectionCard>
  );
}
