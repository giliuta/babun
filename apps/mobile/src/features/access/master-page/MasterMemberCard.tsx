import { useState } from "react";
import { Keyboard } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";

import { useAppointments } from "@/features/calendar/queries";
import { useBusinessNow } from "@/features/appointments/business-now";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import { useMasters, useTeams, useUpdateMaster } from "@/features/reference/queries";
import { useRemoveTenantMember } from "@/features/settings/team-access";
import { chooseOption } from "@/lib/choose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import { refusalOf, type AccessRefusal } from "../access-map";
import { waitSheetExit } from "../InviteMemberSheet";
import {
  AccessRequestError,
  useAccessBlocks,
  useCalendarMembers,
  useMemberAccess,
  useSetMemberCalendars,
} from "../queries";
import { removalMessage, upcomingWorkCount } from "./removal-impact";
import { CalendarPickerSheet } from "./CalendarPickerSheet";
import { HeaderMenuButton, MasterCardView } from "./MasterCardView";
import { withLiveTeams } from "./master-draft";
import { MEMBER_REFUSAL_TEXT, RIGHTS_AREAS, areaLevelsOf, draftFromMemberAccess, liveAreasOf } from "./rights-rows";

// СОТРУДНИК — ТА ЖЕ КАРТОЧКА МАСТЕРА (владелец 15.09: «полная карточка
// мастера»). Раньше тап по человеку в «Мастерах» открывал экран-таблицу прав
// с переключателями; теперь это карточка: личность, календари, четыре раздела
// прав одним словом, сами права — своей страницей.
//
// Правила прежнего экрана сохранены: права читает и пишет только владелец
// (отказ сервера — словами `MEMBER_REFUSAL_TEXT`), неживые блоки на странице
// прав пригашены. Имя, телефон, должность и цвет пишутся в карточку мастера
// этого аккаунта (`useUpdateMaster`); у человека без карточки их писать
// некуда — строки только показываются.
//
// КАЛЕНДАРИ ПРАВЯТСЯ ЗДЕСЬ ЖЕ (владелец 20.09: «хочу полное редактирование
// правил для мастера»). Раньше они только показывались — `set_member_calendars`
// не звал ни один экран, и человека нельзя было ни прикрепить, ни открепить
// после приглашения. Это ломало и права: уровни ставятся В КАЛЕНДАРЕ.
// Открепление — действие с последствиями, поэтому оно спрашивает подтверждение
// словами: в откреплённом календаре человек теряет и записи, и деньги.

export const memberRefusal = (error: unknown): AccessRefusal =>
  error instanceof AccessRequestError ? refusalOf(error) : "other";

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
  const teamsQuery = useTeams();
  const blocksQuery = useAccessBlocks();
  const accessQuery = useMemberAccess(userId);
  const membersQuery = useCalendarMembers(teamId ?? undefined);
  const mastersQuery = useMasters({ includeInactive: true });
  // Записи компании уже греются календарём — счёт берётся из того же кэша.
  const appts = useAppointments();
  const businessNow = useBusinessNow();
  const updateMaster = useUpdateMaster();
  const remove = useRemoveTenantMember();
  const setCalendars = useSetMemberCalendars(userId);
  const [nameText, setNameText] = useState<string | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);

  const member = membersQuery.data?.find((candidate) => candidate.userId === userId) ?? null;
  const card = mastersQuery.data?.find((master) => master.user_id === userId) ?? null;
  const name = card?.full_name || member?.name || "";

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
        <ScreenHeader title={name || "Сотрудник"} onBack={back} />
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
    phone: formatPhoneAsYouType(card?.phone ?? member?.phone ?? ""),
    title: card?.title ?? "",
    color: card?.color ?? null,
  };
  // Архивный календарь в слове раздела не считается — как на странице прав.
  const draft = withLiveTeams(
    draftFromMemberAccess(accessQuery.data, identity),
    new Set(teams.map((team) => team.id)),
  );

  /** Прикрепить или открепить календарь. Открепление спрашивает словами: в
   *  этом календаре человек разом теряет и записи, и деньги, и права — их
   *  уровни там больше не считаются. */
  const toggleCalendar = async (id: string) => {
    const current = draft.teamIds;
    const attached = current.includes(id);
    const next = attached ? current.filter((teamId) => teamId !== id) : [...current, id];
    const save = () => {
      setCalendars.mutate(next, {
        onError: (error) => toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error"),
      });
    };
    if (!attached) {
      save();
      return;
    }
    const teamName = teamNameOf(id) ?? "этот календарь";
    // ВОПРОС НЕЛЬЗЯ ЗАДАТЬ ИЗ-ЗА ОТКРЫТОЙ ШТОРКИ. Подтверждение рисуется
    // хостом на уровне приложения и встало бы ЗА шторкой календарей: палец
    // получил бы ничего, а открепление молча не случилось бы. Сначала
    // закрываем шторку и ждём, пока она уедет (канон 29.08, тот же приём в
    // `MasterInviteCard`).
    setCalendarsOpen(false);
    await waitSheetExit();
    confirmThen(
      `Открепить от «${teamName}»?`,
      {
        message:
          "Записи и деньги этого календаря пропадут у человека сразу. Права в нём тоже перестанут действовать.",
        confirmLabel: "Открепить",
        destructive: true,
      },
      save,
    );
  };

  const patchCard = (patch: {
    full_name?: string;
    phone?: string | null;
    title?: string | null;
    color?: string | null;
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
  // «Убрать из компании», а не «из календаря»: членство одно на компанию, а
  // открепить от одного календаря приложение ещё не умеет. Слово не обещает
  // меньше, чем будет.
  const openMenu = async () => {
    if (!member) return;
    Keyboard.dismiss();
    const picked = await chooseOption(member.name, [
      { label: "Убрать из компании", destructive: true },
    ]);
    if (picked !== 0) return;
    await waitSheetExit();
    confirmThen(
      `Убрать ${member.name} из компании?`,
      {
        // ВОПРОС НАЗЫВАЕТ ЦИФРУ. Владельца держит не «пропадёт доступ», а то,
        // что на четверг у человека три выезда: убрал в среду — узнал от
        // клиента (`removal-impact.ts`).
        message: removalMessage(
          upcomingWorkCount(appts.data ?? [], card?.id, businessNow().ymd),
        ),
        confirmLabel: "Убрать",
        destructive: true,
      },
      async () => {
        try {
          await remove.mutateAsync(member.userId);
          void qc.invalidateQueries({ queryKey: ["calendar-members"] });
          toast(`${member.name} больше не в компании`);
          onBack();
        } catch (error) {
          notify("Не удалось убрать из компании", (error as Error).message);
        }
      },
    );
  };

  return (
    <>
      <MasterCardView
        title={name || member?.email || "Сотрудник"}
        onBack={back}
        headerRight={
        member && isStaff ? (
          <HeaderMenuButton label="Действия с сотрудником" onPress={() => void openMenu()} />
        ) : undefined
        }
        identity={identity}
        live={false}
        editable={card !== null}
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
        onTitleChange={(value) => patchCard({ title: value.trim() || null })}
        teams={teams}
        teamIds={draft.teamIds}
        onOpenCalendars={() => {
        Keyboard.dismiss();
        setCalendarsOpen(true);
        }}
        liveAreas={liveAreasOf(blocks, RIGHTS_AREAS)}
        showCalendars
        areaLevels={areaLevelsOf(blocks, draft)}
        onOpenArea={(area) =>
        router.push(
          `/calendar/masters/access/${userId}?team=${encodeURIComponent(teamId ?? "")}&rights=1&area=${area}` as Href,
        )
        }
        />
      <CalendarPickerSheet
        visible={calendarsOpen}
        teams={teams}
        selected={draft.teamIds}
        onToggle={(id) => void toggleCalendar(id)}
        onClose={() => setCalendarsOpen(false)}
      />
    </>
  );
}
