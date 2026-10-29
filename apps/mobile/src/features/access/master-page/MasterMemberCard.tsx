import { useRef, useState } from "react";
import { previewLabel } from "./preview-label";
import { Keyboard } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";

import { useAppointments } from "@/features/calendar/queries";
import { useBusinessNow } from "@/features/appointments/business-now";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import { formatPhoneAsYouType } from "@/lib/phone";
import { phoneToSave } from "@/features/profile/profile";
import { useMasters, useTeams, useUpdateMaster } from "@/features/reference/queries";
import { useRemoveTenantMember } from "@/features/settings/team-access";

import { levelOf as mapLevelOf, type AccessBlock, type AccessRefusal } from "@/session/access-map";
import {
  useAccessBlocks,
  useCompanyMembers,
  useMemberAccess,
  useSetMemberAccess,
  useSetMemberCalendars,
} from "@/session/access-queries";
import { draftTeamBrief } from "../rights-ui/team-sentence";
import { AccessSectionsCard } from "../rights-ui/AccessSectionsCard";
import { MasterWorkBlock } from "./MasterProfileBlocks";
import { MemberTeamRole } from "./MemberTeamRole";
import { PartnerPersonalBlocks } from "./PartnerPersonalBlocks";
import { PartnerFilesBlock } from "./PartnerFilesBlock";
import { seenLine } from "./partner-facts";
import { EmployeeNoteBlock } from "./EmployeeNoteBlock";
import { contactsHolderOf, useMasterProfileWrite } from "./use-profile-write";
import { rightsFocusQuery } from "./rights-focus";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { CalendarPickerSheet } from "./CalendarPickerSheet";
import { CALENDAR_GROUPS } from "./access-summary";
import { activeOf, usePreview } from "./rights-page-shared";
import { memberRefusal } from "./member-rights-writer";
import { viewSections } from "./rights-view-sections";
import { usePartnerManager, useTeamsAllowed } from "@/session/use-partner-manager";
import { HeaderMenuButton, MasterCardView } from "./MasterCardView";
import { withLiveTeams } from "./master-draft";
import {
  MEMBER_REFUSAL_TEXT,
  areaLevelsOf,
  companyAreasOf,
  draftFromMemberAccess,
} from "./rights-rows";
import { ActionMenuSheet, type ActionMenu } from "@/components/blocks/ActionMenuSheet";
import { calendarToggler } from "./member-calendar-toggle";
import { createCalendarSendQueue } from "./calendar-send-queue";
import { memberMenuActions } from "./member-menu";

// СОТРУДНИК — ТА ЖЕ КАРТОЧКА МАСТЕРА: личность, календари, четыре раздела
// прав одним словом, сами права — своей страницей.
//
// Права читает и пишет только владелец
// (отказ сервера — словами `MEMBER_REFUSAL_TEXT`), неживые блоки на странице
// прав пригашены. Имя, телефон, должность и цвет пишутся в карточку мастера
// этого аккаунта (`useUpdateMaster`); у человека без карточки их писать
// некуда — строки только показываются.
//
// КАЛЕНДАРИ ПРАВЯТСЯ ЗДЕСЬ ЖЕ (`set_member_calendars`): иначе человека нельзя
// ни прикрепить, ни открепить после приглашения, а уровни прав ставятся В
// КАЛЕНДАРЕ.
// Открепление — действие с последствиями, поэтому оно спрашивает подтверждение
// словами: в откреплённом календаре человек теряет и записи, и деньги.

export function MasterMemberCard({
  userId,
  teamId,
  onBack,
}: {
  userId: string;
  teamId: string | null;
  onBack: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const teamsQuery = useTeams({ display: true });
  const blocksQuery = useAccessBlocks({ fresh: true });
  const accessQuery = useMemberAccess(userId);
  // ДИРЕКТОР: себя и директоров не правит, команды — только свои,
  // «его глазами» и «Убрать» — по праву (`partner-manager.ts`).
  const manager = usePartnerManager(userId, accessQuery.data);
  const teamsAllowed = useTeamsAllowed();
  const membersQuery = useCompanyMembers();
  const mastersQuery = useMasters({ includeInactive: true });
  // Записи компании уже греются календарём — счёт берётся из того же кэша.
  const appts = useAppointments();
  const businessNow = useBusinessNow();
  const updateMaster = useUpdateMaster();
  const remove = useRemoveTenantMember();
  const setCalendars = useSetMemberCalendars(userId);
  const calendarQueue = useRef(createCalendarSendQueue()).current;
  const setAccess = useSetMemberAccess(userId);
  const preview = usePreview();
  const [nameText, setNameText] = useState<string | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [menu, setMenu] = useState<ActionMenu | null>(null);
  // КОМАНДА, ЧЬИ ПРАВА НА СТРАНИЦЕ (лента под шапкой). Первой — та, из
  // которой открыли; её нет среди его команд — первая из них.
  const [activeTeam, setActiveTeam] = useState<string | null>(teamId);
  // Кто ждёт, пока лист календарей уедет (`onExited`).
  const afterCalendars = useRef<(() => void) | null>(null);
  const closeCalendarsSheet = () =>
    new Promise<void>((resolve) => {
      // Лист уже закрыли раньше («Применить» до ответа сервера) — `onExited`
      // не придёт; страховка по времени, чтобы вопрос не пропал вовсе.
      const fallback = setTimeout(() => {
        afterCalendars.current = null;
        resolve();
      }, 900);
      afterCalendars.current = () => {
        clearTimeout(fallback);
        resolve();
      };
      setCalendarsOpen(false);
    });

  const member = membersQuery.data?.find((candidate) => candidate.userId === userId) ?? null;
  const card = mastersQuery.data?.find((master) => master.user_id === userId) ?? null;
  const name = card?.full_name || member?.name || "";
  const profileWrite = useMasterProfileWrite(card);

  const back = () => {
    Keyboard.dismiss();
    onBack();
  };

  const failure = blocksQuery.error ?? accessQuery.error;
  const teams = teamsQuery.data;
  // Список календарей ждём: слово раздела считается только по календарям с
  // чипом, а пустой список до ответа показал бы «Скрыт» у всех разделов.
  if (failure || teamsQuery.isError || !blocksQuery.data || !accessQuery.data || !teams) {
    const refusal: AccessRefusal | null = failure
      ? memberRefusal(failure)
      : teamsQuery.isError
        ? "other"
        : null;
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={name || "Партнёр"} onBack={back} />
        {refusal ? (
          <EmptyState
            state="error"
            fill
            title={refusal === "other" ? "Не удалось загрузить права" : MEMBER_REFUSAL_TEXT[refusal]}
            action={{
              label: "Повторить",
              onPress: () => {
                void blocksQuery.refetch();
                void accessQuery.refetch();
                void teamsQuery.refetch();
              },
            }}
          />
        ) : (
          <EmptyState state="loading" fill />
        )}
      </Screen>
    );
  }

  // Реестр и поиск имени календаря — по одному разу на рендер: раньше то и
  // другое считалось в каждом пропе заново.
  const blocks = blocksQuery.data;
  const teamNameOf = (id: string) => teams.find((team) => team.id === id)?.name ?? null;

  const identity = {
    name: nameText ?? name,
    email: member?.email ?? "",
    phone: formatPhoneAsYouType(card?.phone || member?.phone || ""),
    title: card?.title ?? "",
    color: card?.color ?? null,
  };
  // Архивный календарь в слове раздела не считается — как на странице прав.
  const draft = withLiveTeams(
    draftFromMemberAccess(accessQuery.data, identity),
    new Set(teams.map((team) => team.id)),
  );

  const toggleCalendar = calendarToggler({
    manager,
    teamsAllowed,
    draft,
    calendarQueue,
    blocks,
    teamNameOf,
    setCalendars,
    setAccess,
    toast,
    setActiveTeam,
    setCalendarsOpen,
    closeCalendarsSheet,
  });

  // ПРАВА ВЫБРАННОЙ КОМАНДЫ — ПРЯМО НА СТРАНИЦЕ. Тот же набор, что на
  // отдельной странице команды, плюс права компании.
  // Без команды из адреса — первая в ленте, а она идёт порядком команд.
  const activeId = activeOf(
    activeTeam,
    teams.filter((team) => draft.teamIds.includes(team.id)).map((team) => team.id),
  );
  const map = accessQuery.data;
  const levelOf = (block: AccessBlock, pickTeam: string | null) => mapLevelOf(block, map, pickTeam ?? "");
  const rightsSectionsNow = viewSections({
    blocks,
    levelOf,
    activeId,
    onlyCalendar: true,
    onlyCompany: false,
    withCompany: true,
  });

  const patchCard = (patch: {
    full_name?: string;
    phone?: string | null;
    title?: string | null;
    color?: string | null;
    is_active?: boolean;
  }) => {
    if (!card) return;
    updateMaster.mutate(
      { id: card.id, patch },
      { onError: (error) => toast(error.message, "error") },
    );
  };

  const commitName = () => {
    const typed = nameText?.trim() ?? "";
    setNameText(null);
    if (typed && typed !== name) patchCard({ full_name: typed });
  };

  const isStaff = member?.role === "master" || member?.role === "dispatcher";
  const { openMenu } = memberMenuActions({
    member,
    card,
    patchCard,
    setMenu,
    toast,
    appointments: appts.data,
    teamIds: draft.teamIds,
    businessNow,
    remove,
    qc,
    onBack,
  });

  return (
    <>
      <MasterCardView
        title={name || member?.email || "Партнёр"}
        onBack={back}
        headerRight={
        member && isStaff && manager.canRemove ? (
          <HeaderMenuButton label="Действия с партнёром" onPress={openMenu} />
        ) : undefined
        }
        identity={identity}
        // Живой ли аккаунт — когда он последний раз был в приложении.
        accountSeen={member ? seenLine(member.lastSeenAt, new Date()) : undefined}
        live={false}
        editable={card !== null && !manager.readOnly}
        emailEditable={false}
        emailState="plain"
        onNameChange={setNameText}
        onNameCommit={commitName}
        onColorChange={(color) => patchCard({ color })}
        onPhoneChange={(value) => {
        const phone = phoneToSave(value);
        if (phone === undefined) {
          toast("Номер без кода страны", "error");
          return;
        }
        patchCard({ phone });
        }}
        teams={teams}
        teamIds={draft.teamIds}
        onOpenCalendars={
          manager.readOnly
            ? undefined
            : () => {
                Keyboard.dismiss();
                setCalendarsOpen(true);
              }
        }
        liveAreas={companyAreasOf(blocks)}
        showCalendars
        areaLevels={areaLevelsOf(blocks, draft)}
        // Права компании (клиенты) — своей страницей; календарные живут в
        // строках календарей.
        onOpenArea={(area) =>
          router.push(
            `/cabinet/people/access/${userId}?team=${encodeURIComponent(teamId ?? "")}&rights=1&area=${area}&${rightsFocusQuery({ kind: "company" })}` as Href,
          )
        }
        // У КАЖДОГО КАЛЕНДАРЯ СВОИ ПРАВА: строка календаря
        // говорит, что человек может в НЁМ, и открывает права этого календаря.
        teamLine={(id) => draftTeamBrief(blocks, draft, id)}
        // «Посмотреть его глазами» — строкой в блоке «Доступ», а не в ⋯.
        onMirror={manager.canPreview ? () => preview({ blocks, draft, name, userId }) : undefined}
        onOpenCalendarRights={(id) =>
          router.push(
            `/cabinet/people/access/${userId}?team=${encodeURIComponent(teamId ?? id)}&rights=1&${rightsFocusQuery({ kind: "calendar", teamId: id })}` as Href,
          )
        }
        onDetachCalendar={manager.readOnly ? undefined : (id) => void toggleCalendar(id)}
        phoneAction={
          identity.phone ? <PhoneChannelButton number={card?.phone || member?.phone || ""} label={name} /> : undefined
        }
        contacts={
          card
            ? { holder: contactsHolderOf(profileWrite.profile), update: profileWrite.writeContacts }
            : undefined
        }
        note={card ? <EmployeeNoteBlock card={card} readOnly={!!manager.readOnly} /> : undefined}
        teamChips={{
          activeId,
          onSelect: setActiveTeam,
          onAdd: manager.readOnly
            ? undefined
            : () => {
                Keyboard.dismiss();
                setCalendarsOpen(true);
              },
        }}
        teamRights={
          // ДОСТУП — ПОСТРАНИЧНО: строка раздела, тап — страница со всеми его
          // правами в выбранной команде. Карточки «Итог» с «Шаблоном» над ним
          // нет.
          <AccessSectionsCard
            sections={rightsSectionsNow}
            role={
              activeId ? (
                <MemberTeamRole
                  userId={userId}
                  blocks={blocks}
                  map={map}
                  teamId={activeId}
                  teamName={teamNameOf(activeId) ?? ""}
                  locked={!!manager.readOnly}
                />
              ) : undefined
            }
            onOpen={(section) => {
              Keyboard.dismiss();
              const group = CALENDAR_GROUPS.find((each) => each === section.key);
              const focus =
                group && activeId
                  ? rightsFocusQuery({ kind: "calendar", teamId: activeId, group })
                  : rightsFocusQuery({ kind: "company" });
              router.push(
                `/cabinet/people/access/${userId}?team=${encodeURIComponent(activeId ?? teamId ?? "")}&rights=1&${focus}` as Href,
              );
            }}
          />
        }
        // ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ (канон 7.1): посмотреть, что из этого выйдет.
        footer={
          manager.canPreview ? (
            <GradientButton label={previewLabel(name)} onPress={() => preview({ blocks, draft, name, userId })} />
          ) : undefined
        }
      >
        {card ? (
          <>
            {/* «РАБОТА» — ПО ЧИПУ: лента команд сверху выбирает команду, и
                блок считает её, а не сумму всех его команд одинаково на любом
                чипе. */}
            <MasterWorkBlock
              card={card}
              teamIds={activeId ? [activeId] : draft.teamIds}
              teamName={activeId && draft.teamIds.length > 1 ? teamNameOf(activeId) : null}
              userId={userId}
            />
            {/* Журнала «Номера клиентов» нет: номер приходит целиком с блоком
                «Клиент», открытий по одному не бывает. */}
            <PartnerPersonalBlocks card={card} joinedAt={member?.joinedAt ?? null} readOnly={!!manager.readOnly} />
            {/* Договор, копия документа — его бумаги у владельца. */}
            <PartnerFilesBlock masterId={card.id} canWrite={!manager.readOnly} />
          </>
        ) : null}
      </MasterCardView>
      <ActionMenuSheet menu={menu} onClose={() => setMenu(null)} />
      <CalendarPickerSheet
        visible={calendarsOpen}
        teams={teamsAllowed ? teams.filter((team) => teamsAllowed.has(team.id) || draft.teamIds.includes(team.id)) : teams}
        selected={draft.teamIds}
        onToggle={(id) => void toggleCalendar(id)}
        onClose={() => setCalendarsOpen(false)}
        onExited={() => {
          const run = afterCalendars.current;
          afterCalendars.current = null;
          run?.();
        }}
      />
    </>
  );
}
