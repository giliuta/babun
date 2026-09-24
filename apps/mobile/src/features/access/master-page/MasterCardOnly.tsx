import { useMemo, useState } from "react";
import { Keyboard } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MailCheck, Send } from "lucide-react-native";

import { ChooseRow } from "@/components/ui/ChooseRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import { usePendingInvitations } from "@/features/settings/team-access";
import {
  useDeleteMaster,
  useMaster,
  useRemoveMasterFromTeams,
  useTeams,
  useUpdateMaster,
  type Team,
} from "@/features/reference/queries";
import { chooseOption } from "@/lib/choose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import { waitSheetExit } from "../InviteMemberSheet";
import { cardTeamIds } from "../masters-list";
import { openMasterDraftFromCard } from "./draft-store";
import { invitationSegment } from "./master-draft";
import { HeaderMenuButton, MasterCardView } from "./MasterCardView";
import { MasterPersonalBlocks, MasterWorkBlock } from "./MasterProfileBlocks";

// МАСТЕР БЕЗ АККАУНТА — ТА ЖЕ СТРАНИЦА (STORY-087). Карточка мастера без входа
// в CRM законна: владелец ставит его в календарь и сам ведёт записи. Раньше
// она открывалась старым хабом (аватар, «Информация», «Визиты», тумблер), а
// теперь — тем же телом, что сотрудник: «Сотрудник», «Календари», «Работа»,
// «Личное». Вместо прав — блок «Доступ в CRM» с дверью «Пригласить в CRM»:
// приглашение уходит ПО ЭТОЙ карточке (`create_invitation(p_master_id)`), и
// после ответа человек входит уже со своими записями и календарём.

export function MasterCardOnly({ cardId, onBack }: { cardId: string; onBack: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const cardQuery = useMaster(cardId);
  const teamsQuery = useTeams();
  const allTeamsQuery = useTeams({ includeInactive: true });
  const update = useUpdateMaster();
  const del = useDeleteMaster();
  const removeFromTeams = useRemoveMasterFromTeams();
  const invitations = usePendingInvitations();
  const [nameText, setNameText] = useState<string | null>(null);
  const card = cardQuery.data ?? null;
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  // Календари карточки: свой `team_id` и старый состав бригады.
  const teamIds = useMemo(() => (card ? cardTeamIds(card, teams) : []), [card, teams]);

  if (cardQuery.isLoading || teamsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" onBack={onBack} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" onBack={onBack} />
        <EmptyState fill title="Мастер не найден" />
      </Screen>
    );
  }

  const name = card.full_name || "";
  // Приглашение по этой карточке уже в пути — второе «Пригласить» завело бы
  // двойника: дверь ведёт в ждущее приглашение.
  const pending = (invitations.data ?? []).find((row) => row.master_id === card.id) ?? null;
  const patch = (next: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: card.id, patch: next }, { onError: (e) => toast(e.message, "error") });

  const commitName = () => {
    const typed = nameText?.trim() ?? "";
    setNameText(null);
    if (typed && typed !== name) patch({ full_name: typed });
  };

  const invite = () => {
    Keyboard.dismiss();
    openMasterDraftFromCard({
      teamId: teamIds[0] ?? null,
      masterId: card.id,
      name,
      phone: card.phone ? formatPhoneAsYouType(card.phone) : "",
      teamIds,
    });
    router.push(
      `/calendar/masters/new?team=${encodeURIComponent(teamIds[0] ?? "")}&card=${encodeURIComponent(card.id)}` as Href,
    );
  };

  const remove = () =>
    confirmThen(
      `Удалить «${name || "мастера"}»?`,
      {
        message:
          "Карточка уйдёт из календарей. Записи календаря останутся — они принадлежат календарю, а не мастеру.",
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        del.mutate(card.id, {
          // После удаления вычистить карточку из составов ВСЕХ команд, включая
          // архивные: иначе мастер-призрак воскресает при их возврате.
          onSuccess: () =>
            removeFromTeams.mutate(
              { masterId: card.id, teams: allTeamsQuery.data ?? [] },
              {
                onError: (e) => notify("Ошибка", (e as Error).message),
                onSettled: onBack,
              },
            ),
          onError: (e) => notify("Ошибка", (e as Error).message),
        }),
    );

  const openMenu = async () => {
    Keyboard.dismiss();
    const picked = await chooseOption(name || "Мастер", [
      { label: card.is_active ? "В архив" : "Вернуть из архива" },
      { label: "Удалить", destructive: true },
    ]);
    if (picked === 0) {
      patch({ is_active: !card.is_active });
      toast(card.is_active ? "Мастер в архиве" : "Мастер снова в работе");
    } else if (picked === 1) {
      await waitSheetExit();
      remove();
    }
  };

  const chosenTeams: Team[] = teamIds
    .map((id) => teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined);

  return (
    <MasterCardView
      title={name || "Мастер"}
      subtitle={card.is_active ? undefined : "В архиве"}
      onBack={onBack}
      headerRight={<HeaderMenuButton label="Действия с мастером" onPress={() => void openMenu()} />}
      identity={{
        name: nameText ?? name,
        email: "",
        phone: card.phone ? formatPhoneAsYouType(card.phone) : "",
        title: card.title ?? "",
        color: card.color ?? null,
      }}
      live={false}
      editable
      // Почты у карточки нет: она появляется с приглашением.
      emailEditable={false}
      hideEmail
      emailState="plain"
      onNameChange={setNameText}
      onNameCommit={commitName}
      onColorChange={(color) => patch({ color })}
      onPhoneChange={(value) => {
        const phone = phoneToSave(value);
        if (phone === undefined) {
          toast("Номер без кода страны", "error");
          return;
        }
        patch({ phone });
      }}
      onTitleChange={(value) => patch({ title: value.trim() || null })}
      teams={chosenTeams}
      teamIds={teamIds}
      showCalendars
      liveAreas={[]}
      areaLevels={null}
      onOpenArea={() => {}}
      phoneAction={card.phone ? <PhoneChannelButton number={card.phone} label={name} /> : undefined}
    >
      <SectionCard title="Доступ в CRM" padded={false}>
        {pending ? (
          <ChooseRow
            compact
            icon={MailCheck}
            label="Приглашение ждёт ответа"
            hint={pending.email}
            onPress={() =>
              router.push(`/calendar/masters/${invitationSegment(pending.id)}` as Href)
            }
          />
        ) : (
          <ChooseRow compact icon={Send} label="Пригласить в CRM" onPress={invite} />
        )}
      </SectionCard>
      <MasterWorkBlock card={card} teamIds={teamIds} />
      <MasterPersonalBlocks card={card} />
    </MasterCardView>
  );
}
