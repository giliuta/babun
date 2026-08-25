import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { Check, ChevronRight, Link2, ShieldCheck, UserRound } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useSession } from "@/providers/SessionProvider";
import { useMasters } from "@/features/reference/queries";
import {
  usePendingInvitations,
  useCreateInvitation,
  useRemoveTenantMember,
  useRevokeInvitation,
  useTenantMembers,
  useUpdateTenantMember,
  type TenantMember,
} from "@/features/settings/team-access";
import { useTenant } from "@/features/settings/tenant";
import {
  invitationErrorMessage,
  invitationPath,
  invitationShareText,
  isInvitationEmail,
  type InvitableRole,
} from "@/features/settings/invitation-flow";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  USER_ROLES,
  type UserRole,
} from "@/features/settings/role-policy";

export default function TeamAccessScreen() {
  const t = useThemeColors();
  const { session } = useSession();
  const membersQuery = useTenantMembers();
  const invitationsQuery = usePendingInvitations();
  const tenantQuery = useTenant();
  const mastersQuery = useMasters({ includeInactive: true });
  const masters = useMemo(() => mastersQuery.data ?? [], [mastersQuery.data]);
  const update = useUpdateTenantMember();
  const remove = useRemoveTenantMember();
  const revoke = useRevokeInvitation();
  const createInvitation = useCreateInvitation();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("master");
  const [inviteMasterId, setInviteMasterId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TenantMember | null>(null);
  const [role, setRole] = useState<UserRole>("master");
  const [masterId, setMasterId] = useState<string | null>(null);

  const activeMasters = useMemo(
    () => masters.filter((master) => master.is_active),
    [masters],
  );
  const availableInviteMasters = useMemo(() => {
    const unavailable = new Set<string>();
    for (const member of membersQuery.data ?? []) {
      if (member.master_id) unavailable.add(member.master_id);
    }
    for (const invitation of invitationsQuery.data ?? []) {
      if (invitation.master_id) unavailable.add(invitation.master_id);
    }
    return activeMasters.filter((master) => !unavailable.has(master.id));
  }, [activeMasters, invitationsQuery.data, membersQuery.data]);
  const availableEditMasters = useMemo(() => {
    const unavailable = new Set<string>();
    for (const member of membersQuery.data ?? []) {
      if (member.user_id !== editing?.user_id && member.master_id) {
        unavailable.add(member.master_id);
      }
    }
    for (const invitation of invitationsQuery.data ?? []) {
      if (invitation.master_id) unavailable.add(invitation.master_id);
    }
    return masters.filter(
      (master) =>
        (master.is_active || master.id === editing?.master_id) &&
        !unavailable.has(master.id),
    );
  }, [editing?.master_id, editing?.user_id, invitationsQuery.data, masters, membersQuery.data]);
  const owners = membersQuery.data?.filter((member) => member.role === "owner").length ?? 0;

  useEffect(() => {
    if (inviteRole !== "master") {
      setInviteMasterId(null);
      return;
    }
    setInviteMasterId((current) =>
      current && availableInviteMasters.some((master) => master.id === current)
        ? current
        : (availableInviteMasters[0]?.id ?? null),
    );
  }, [availableInviteMasters, inviteRole]);

  const openMember = (member: TenantMember) => {
    setEditing(member);
    setRole(member.role);
    setMasterId(member.master_id);
  };

  const shareInvitation = async (invitation: {
    email: string;
    role: string;
    token: string;
  }) => {
    const roleLabel =
      invitation.role === "dispatcher"
        ? ROLE_LABELS.dispatcher
        : ROLE_LABELS.master;
    const url = Linking.createURL(invitationPath(invitation.token));
    await Share.share({
      title: `Доступ для ${invitation.email}`,
      message: invitationShareText({
        tenantName: tenantQuery.data?.name,
        roleLabel,
        url,
      }),
      url,
    });
  };

  const createAndShare = async () => {
    if (!isInvitationEmail(inviteEmail)) {
      Alert.alert("Проверьте email", "Введите полный адрес сотрудника.");
      return;
    }
    if (inviteRole === "master" && !inviteMasterId) {
      Alert.alert(
        "Выберите карточку сотрудника",
        "Для доступа мастера нужна свободная карточка бригадира или мастера.",
      );
      return;
    }
    try {
      const invitation = await createInvitation.mutateAsync({
        email: inviteEmail,
        masterId: inviteRole === "master" ? inviteMasterId : null,
        role: inviteRole,
      });
      setInviteEmail("");
      try {
        await shareInvitation(invitation);
      } catch {
        Alert.alert(
          "Приглашение создано",
          "Его можно отправить позже из списка «Ожидают входа».",
        );
      }
    } catch (error) {
      Alert.alert(
        "Не удалось создать приглашение",
        invitationErrorMessage((error as Error).message),
      );
    }
  };

  const save = async () => {
    if (!editing) return;
    if (role === "master" && !masterId) {
      Alert.alert(
        "Выберите карточку сотрудника",
        "Мастеру нужна карточка, по которой CRM определит его заявки и команду.",
      );
      return;
    }
    try {
      await update.mutateAsync({
        userId: editing.user_id,
        role,
        masterId: role === "master" ? masterId : null,
      });
      setEditing(null);
    } catch (error) {
      Alert.alert("Не удалось сохранить", (error as Error).message);
    }
  };

  const removeMember = () => {
    if (!editing) return;
    Alert.alert(
      "Закрыть доступ?",
      "Сотрудник выйдет из компании и больше не увидит её данные.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Закрыть доступ",
          style: "destructive",
          onPress: async () => {
            try {
              await remove.mutateAsync(editing.user_id);
              setEditing(null);
            } catch (error) {
              Alert.alert("Не удалось закрыть доступ", (error as Error).message);
            }
          },
        },
      ],
    );
  };

  if (
    membersQuery.isLoading ||
    invitationsQuery.isLoading ||
    tenantQuery.isLoading ||
    mastersQuery.isLoading
  ) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступ в CRM" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  const readError =
    membersQuery.error ||
    invitationsQuery.error ||
    tenantQuery.error ||
    mastersQuery.error;
  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Доступ в CRM" />
        <EmptyState
          state="error"
          fill
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([
                membersQuery.refetch(),
                invitationsQuery.refetch(),
                tenantQuery.refetch(),
                mastersQuery.refetch(),
              ]),
          }}
        />
      </Screen>
    );
  }

  const members = membersQuery.data ?? [];
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Доступ в CRM" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <SectionCard className="mt-3" padded>
          <View className="flex-row gap-3">
            <ShieldCheck color={t.accent} size={ICON.md} />
            <View className="flex-1">
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                Роль ограничивает весь рабочий сценарий
              </Text>
              <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: t.sub }}>
                Владелец управляет компанией и финансами, диспетчер ведёт записи,
                мастер работает только с назначенными заявками.
              </Text>
            </View>
          </View>
        </SectionCard>

        <SectionEyebrow>Новое приглашение</SectionEyebrow>
        <SectionCard padded>
          <Text
            style={{
              marginBottom: 7,
              fontSize: 12,
              fontWeight: "600",
              color: t.sub,
            }}
          >
            EMAIL СОТРУДНИКА
          </Text>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="employee@example.com"
            placeholderTextColor={t.faint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            keyboardAppearance="light"
            inputMode="email"
            returnKeyType="done"
            onSubmitEditing={() => void createAndShare()}
            accessibilityLabel="Email сотрудника"
            style={{
              minHeight: 50,
              borderRadius: t.radius.card,
              paddingHorizontal: 14,
              fontSize: 16,
              color: t.ink,
              backgroundColor: t.fill,
              borderWidth: 1,
              borderColor: t.separator,
            }}
          />

          <Text
            style={{
              marginTop: 18,
              marginBottom: 5,
              fontSize: 12,
              fontWeight: "600",
              color: t.sub,
            }}
          >
            РОЛЬ
          </Text>
          {(["master", "dispatcher"] as const).map((option) => {
            const selected = inviteRole === option;
            return (
              <Pressable
                key={option}
                onPress={() => setInviteRole(option)}
                disabled={createInvitation.isPending}
                accessibilityRole="radio"
                accessibilityLabel={ROLE_LABELS[option]}
                accessibilityState={{
                  selected,
                  disabled: createInvitation.isPending,
                }}
                style={({ pressed }) => ({
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <View
                  className="h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? t.accent : t.separator,
                    backgroundColor: selected ? t.accent : "transparent",
                  }}
                >
                  {selected ? <Check color={t.onAccent} size={14} /> : null}
                </View>
                <View className="flex-1">
                  <Text
                    style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                  >
                    {ROLE_LABELS[option]}
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: 12,
                      lineHeight: 16,
                      color: t.sub,
                    }}
                  >
                    {ROLE_DESCRIPTIONS[option]}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {inviteRole === "master" ? (
            <View style={{ marginTop: 14 }}>
              <View className="mb-1 flex-row items-center gap-2">
                <Link2 color={t.sub} size={ICON.sm} />
                <Text
                  style={{ fontSize: 12, fontWeight: "600", color: t.sub }}
                >
                  БРИГАДИР / МАСТЕР
                </Text>
              </View>
              {availableInviteMasters.length > 0 ? (
                availableInviteMasters.map((master) => {
                  const selected = inviteMasterId === master.id;
                  return (
                    <Pressable
                      key={master.id}
                      onPress={() => setInviteMasterId(master.id)}
                      disabled={createInvitation.isPending}
                      accessibilityRole="radio"
                      accessibilityLabel={`Карточка сотрудника ${master.full_name}`}
                      accessibilityState={{
                        selected,
                        disabled: createInvitation.isPending,
                      }}
                      className="min-h-11 flex-row items-center py-2 active:opacity-70"
                    >
                      <Text
                        style={{ flex: 1, fontSize: 15, color: t.ink }}
                        numberOfLines={1}
                      >
                        {master.full_name}
                      </Text>
                      {selected ? (
                        <Check color={t.accent} size={ICON.sm} />
                      ) : null}
                    </Pressable>
                  );
                })
              ) : (
                <Text
                  style={{
                    paddingVertical: 10,
                    fontSize: 13,
                    lineHeight: 18,
                    color: t.sub,
                  }}
                >
                  Нет свободной карточки. Сначала создайте сотрудника в
                  настройках команды или отзовите его старое приглашение.
                </Text>
              )}
            </View>
          ) : null}

          <View className="mt-4">
            <Button
              label={
                createInvitation.isPending
                  ? "Создаём приглашение…"
                  : "Создать и отправить"
              }
              onPress={() => void createAndShare()}
              loading={createInvitation.isPending}
              disabled={
                createInvitation.isPending ||
                !isInvitationEmail(inviteEmail) ||
                (inviteRole === "master" && !inviteMasterId)
              }
            />
          </View>
          <Text
            style={{
              marginTop: 9,
              textAlign: "center",
              fontSize: 12,
              lineHeight: 16,
              color: t.sub,
            }}
          >
            Ссылка действует 7 дней и принимается только этим email.
          </Text>
        </SectionCard>

        <SectionEyebrow>Сотрудники с доступом</SectionEyebrow>
        <SectionCard>
          {members.map((member, index) => {
            const linked = activeMasters.find((master) => master.id === member.master_id);
            const mine = member.user_id === session?.user.id;
            return (
              <View key={member.user_id}>
                {index > 0 ? <Divider inset={60} /> : null}
                <Pressable
                  onPress={() => openMember(member)}
                  accessibilityRole="button"
                  accessibilityLabel={`${memberLabel(member, mine ? session?.user.email : null)}, ${ROLE_LABELS[member.role]}`}
                  className="min-h-[62px] flex-row items-center gap-3 px-4 py-2.5 active:opacity-70"
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.fill }}
                  >
                    <UserRound color={t.accent} size={ICON.sm} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }} numberOfLines={1}>
                      {memberLabel(member, mine ? session?.user.email : null)}
                    </Text>
                    <Text style={{ marginTop: 1, fontSize: 12, color: t.sub }} numberOfLines={1}>
                      {ROLE_LABELS[member.role]}
                      {linked ? ` · ${linked.full_name}` : ""}
                    </Text>
                  </View>
                  <ChevronRight color={t.chevron} size={ICON.sm} />
                </Pressable>
              </View>
            );
          })}
        </SectionCard>

        {(invitationsQuery.data?.length ?? 0) > 0 ? (
          <>
            <SectionEyebrow>Ожидают входа</SectionEyebrow>
            <SectionCard>
              {invitationsQuery.data?.map((invitation, index) => {
                const linked = activeMasters.find(
                  (master) => master.id === invitation.master_id,
                );
                return (
                <View key={invitation.id}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <View className="min-h-[58px] flex-row items-center gap-3 px-4 py-2.5">
                    <View className="min-w-0 flex-1">
                      <Text style={{ fontSize: 15, color: t.ink }} numberOfLines={1}>
                        {invitation.email}
                      </Text>
                      <Text style={{ marginTop: 1, fontSize: 12, color: t.sub }}>
                        {ROLE_LABELS[invitation.role as UserRole] ?? "Сотрудник"}
                        {linked ? ` · ${linked.full_name}` : ""}
                        {` · до ${formatInvitationExpiry(invitation.expires_at)}`}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Pressable
                        onPress={() =>
                          void shareInvitation(invitation).catch(() =>
                            Alert.alert(
                              "Не удалось открыть отправку",
                              "Попробуйте ещё раз.",
                            ),
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Отправить приглашение ${invitation.email}`}
                        className="min-h-11 justify-center px-2 active:opacity-70"
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: t.accent,
                          }}
                        >
                          Отправить
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          Alert.alert("Отозвать приглашение?", invitation.email, [
                            { text: "Отмена", style: "cancel" },
                            {
                              text: "Отозвать",
                              style: "destructive",
                              onPress: () =>
                                revoke.mutate(invitation.id, {
                                  onError: (error) =>
                                    Alert.alert("Ошибка", error.message),
                                }),
                            },
                          ])
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Отозвать приглашение ${invitation.email}`}
                        className="min-h-11 justify-center px-2 active:opacity-70"
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: t.danger,
                          }}
                        >
                          Отозвать
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                );
              })}
            </SectionCard>
          </>
        ) : null}
      </ScrollView>

      <MemberEditor
        member={editing}
        currentUserId={session?.user.id ?? null}
        ownerCount={owners}
        role={role}
        masterId={masterId}
        masters={availableEditMasters}
        busy={update.isPending || remove.isPending}
        onRole={setRole}
        onMaster={setMasterId}
        onClose={() => setEditing(null)}
        onSave={() => void save()}
        onRemove={removeMember}
      />
    </Screen>
  );
}

function formatInvitationExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "7 дней";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function memberLabel(member: TenantMember, ownEmail: string | null | undefined): string {
  if (ownEmail) return `${ownEmail} (вы)`;
  const metadata = member.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const name = metadata.display_name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return `Аккаунт ${member.user_id.slice(0, 8)}`;
}

type MasterOption = { id: string; full_name: string };

function MemberEditor({
  member,
  currentUserId,
  ownerCount,
  role,
  masterId,
  masters,
  busy,
  onRole,
  onMaster,
  onClose,
  onSave,
  onRemove,
}: {
  member: TenantMember | null;
  currentUserId: string | null;
  ownerCount: number;
  role: UserRole;
  masterId: string | null;
  masters: MasterOption[];
  busy: boolean;
  onRole: (role: UserRole) => void;
  onMaster: (id: string | null) => void;
  onClose: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const t = useThemeColors();
  if (!member) return null;
  const self = member.user_id === currentUserId;
  const lastOwner = member.role === "owner" && ownerCount === 1;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: t.scrim }}
        onPress={onClose}
        accessible={false}
      />
      <View style={{ maxHeight: "78%", borderTopLeftRadius: t.radius.card, borderTopRightRadius: t.radius.card, backgroundColor: t.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: t.ink }}>Роль и доступ</Text>
          <Text style={{ marginTop: 4, fontSize: 12, color: t.sub }} selectable>
            {member.user_id}
          </Text>

          <Text style={{ marginTop: 20, marginBottom: 8, fontSize: 12, fontWeight: "600", color: t.sub }}>РОЛЬ</Text>
          {USER_ROLES.map((option) => {
            const selected = role === option;
            const disabled = lastOwner && option !== "owner";
            return (
              <Pressable
                key={option}
                disabled={disabled || busy}
                onPress={() => onRole(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={ROLE_LABELS[option]}
                className="min-h-[58px] flex-row items-center gap-3 py-2 active:opacity-70"
              >
                <View className="h-6 w-6 items-center justify-center rounded-full" style={{ borderWidth: 1, borderColor: selected ? t.accent : t.separator, backgroundColor: selected ? t.accent : "transparent" }}>
                  {selected ? <Check color={t.onAccent} size={14} /> : null}
                </View>
                <View className="flex-1">
                  <Text style={{ fontSize: 15, fontWeight: "600", color: disabled ? t.faint : t.ink }}>{ROLE_LABELS[option]}</Text>
                  <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 16, color: t.sub }}>{ROLE_DESCRIPTIONS[option]}</Text>
                </View>
              </Pressable>
            );
          })}

          {role === "master" ? (
            <View>
              <View className="mt-4 flex-row items-center gap-2">
                <Link2 color={t.sub} size={ICON.sm} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: t.sub }}>
                  БРИГАДИР / МАСТЕР
                </Text>
              </View>
              {masters.map((master) => (
                <Pressable
                  key={master.id}
                  onPress={() => onMaster(master.id)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: masterId === master.id,
                    disabled: busy,
                  }}
                  accessibilityLabel={master.full_name}
                  className="min-h-11 flex-row items-center py-2 active:opacity-70"
                >
                  <Text style={{ flex: 1, fontSize: 15, color: t.ink }}>
                    {master.full_name}
                  </Text>
                  {masterId === master.id ? (
                    <Check color={t.accent} size={ICON.sm} />
                  ) : null}
                </Pressable>
              ))}
              {masters.length === 0 ? (
                <Text
                  style={{ marginTop: 9, fontSize: 12, lineHeight: 16, color: t.sub }}
                >
                  Нет активных карточек сотрудников.
                </Text>
              ) : null}
            </View>
          ) : null}

          {lastOwner ? (
            <Text style={{ marginTop: 10, fontSize: 12, lineHeight: 16, color: t.sub }}>
              Это последний владелец. Сначала назначьте владельцем другого сотрудника.
            </Text>
          ) : null}
          <View className="mt-5"><Button label="Сохранить" onPress={onSave} loading={busy} disabled={busy} /></View>
          {!self && !lastOwner ? (
            <Pressable
              onPress={onRemove}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Закрыть доступ сотруднику"
              accessibilityState={{ disabled: busy }}
              className="min-h-11 items-center justify-center active:opacity-70"
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>Закрыть доступ</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
