import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useRouter, type Href } from "expo-router";

import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import { useTeams } from "@/features/reference/queries";
import { invitationErrorMessage } from "@/features/settings/invitation-flow";
import {
  usePendingInvitations,
  useRevokeInvitation,
} from "@/features/settings/team-access";
import { useTenant } from "@/features/settings/tenant";
import { chooseOption } from "@/lib/choose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import { shareInvitation, waitSheetExit } from "../InviteMemberSheet";
import { useAccessBlocks } from "../queries";
import { CalendarPickerSheet } from "./CalendarPickerSheet";
import { useUpdateMasterInvitation } from "./invitation-api";
import { invitationRefusalText, isInvitationGone } from "./invitation-contract";
import { HeaderMenuButton, MasterCardView } from "./MasterCardView";
import {
  calendarRightsLine,
  clientsRightsLine,
  applyPickedCalendars,
  draftFromInvitation,
  invitationCarriesCardFields,
  invitationRequest,
  invitationSegment,
  toggleTeam,
  withLiveTeams,
  type MasterDraft,
} from "./master-draft";
import { rightsFocusQuery } from "./rights-focus";
import { RIGHTS_AREAS, areaLevelsOf, liveAreasOf } from "./rights-rows";
import { waitSubtitle } from "../invitation-wait";

// ПРИГЛАШЕНИЕ БЕЗ ОТВЕТА — ТА ЖЕ КАРТОЧКА МАСТЕРА (владелец 15.09: всё, что
// заполнено до «Пригласить», можно поправить, пока человек не ответил).
// Правка ложится сразу (`update_invitation`): имя, телефон и должность — по
// уходу из поля, цвет и календари — выбором. Почта только показывается: это
// адрес, на который выписано приглашение. Токен при правке не меняется —
// ссылка у человека остаётся рабочей, поэтому внизу «Отправить ещё раз».

/** Ждущее приглашение из кэша «Ждут ответа». Строки нет после свежего
 *  чтения — его приняли, отозвали или оно истекло: экран уходит назад.
 *  Пока идёт чтение, не уходим: сразу после «Пригласить» кэш ещё старый. */
export function usePendingInvitation(invitationId: string, onGone: () => void) {
  const query = usePendingInvitations();
  const row = query.data?.find((invitation) => invitation.id === invitationId) ?? null;
  const gone = query.isSuccess && !query.isFetching && row === null;
  const left = useRef(false);
  const leave = useRef(onGone);
  useEffect(() => {
    leave.current = onGone;
  });
  useEffect(() => {
    if (!gone || left.current) return;
    left.current = true;
    leave.current();
  }, [gone]);
  return { query, row };
}

const sameTeams = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function MasterInviteCard({
  invitationId,
  onBack,
}: {
  invitationId: string;
  onBack: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const teamsQuery = useTeams();
  const blocksQuery = useAccessBlocks();
  const tenantQuery = useTenant();
  const update = useUpdateMasterInvitation();
  const revoke = useRevokeInvitation();
  const { query, row } = usePendingInvitation(invitationId, onBack);
  // Имя набирается локально и уходит одним запросом по уходу из поля.
  const [nameText, setNameText] = useState<string | null>(null);
  // В шторке копятся только выбранные календари и уходят по «Применить»:
  // снятый по дороге последний календарь не долетает до сервера отказом.
  // Имя, телефон и должность берутся из карточки в момент «Применить» —
  // уход из поля при открытии шторки их уже сохранил, а копия всей карточки,
  // снятая при открытии, затёрла бы их старыми.
  const [sheetTeamIds, setSheetTeamIds] = useState<string[] | null>(null);
  const teams = teamsQuery.data;
  const blocks = blocksQuery.data;
  // Карточка видит те же календари, что страница прав и отправка, — с чипом.
  // Без списка календарей черновика нет: пустой список снял бы все.
  const draft = useMemo(
    () =>
      row && teams
        ? withLiveTeams(draftFromInvitation(row), new Set(teams.map((team) => team.id)))
        : null,
    [row, teams],
  );

  const back = () => {
    Keyboard.dismiss();
    onBack();
  };

  // Без реестра блоков карточку не рисуем вовсе: права ушли бы пустыми и
  // стёрли выставленное, а карточка «только показать» меняла бы вид, когда
  // реестр доедет, и молча оставалась бы такой при его отказе.
  if (!row || !teams || !draft || !blocks) {
    const failed = query.isError || blocksQuery.isError || teamsQuery.isError;
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Приглашение" onBack={back} />
        {failed ? (
          <EmptyState
            fill
            state="error"
            action={{
              label: "Повторить",
              onPress: () => {
                void query.refetch();
                void blocksQuery.refetch();
                void teamsQuery.refetch();
              },
            }}
          />
        ) : (
          <EmptyState fill state="loading" />
        )}
      </Screen>
    );
  }

  const cardFields = invitationCarriesCardFields(row);

  // Должность и цвет приглашения по карточке и диспетчера не шлём: сервер
  // отказал бы или молча стёр их (`invitationCarriesCardFields`).
  const commit = (next: MasterDraft) => {
    const sent = cardFields ? next : { ...next, title: "", color: null };
    update.mutate(
      { invitationId: row.id, request: invitationRequest(sent, blocks, phoneToSave) },
      {
        onError: (error) => {
          if (!isInvitationGone(error)) toast(invitationRefusalText(error), "error");
        },
      },
    );
  };

  const commitName = () => {
    const typed = nameText;
    setNameText(null);
    const name = typed?.trim() ?? "";
    if (!name || name === draft.name.trim()) return;
    commit({ ...draft, name });
  };

  // `draft` — из этой отрисовки: и «Применить», и жест берут свежий `onClose`,
  // поэтому имя, сохранённое уходом из поля, здесь уже новое.
  const closeCalendars = () => {
    const picked = sheetTeamIds;
    setSheetTeamIds(null);
    if (!picked || sameTeams(picked, draft.teamIds)) return;
    if (picked.length === 0) {
      toast(invitationErrorMessage("master invitation requires a calendar"), "error");
      return;
    }
    commit(applyPickedCalendars(draft, picked, true));
  };

  const share = () =>
    shareInvitation({
      email: row.email,
      token: row.token,
      tenantName: tenantQuery.data?.name,
    }).catch(() => notify("Не удалось открыть «Поделиться»", "Попробуйте ещё раз."));

  // Действия бывшей строки «Ждут ответа» переехали в карточку: тап по строке
  // теперь открывает приглашение, а не меню.
  const openMenu = async () => {
    Keyboard.dismiss();
    const picked = await chooseOption(row.full_name || row.email, [
      { label: "Поделиться ссылкой" },
      { label: "Отозвать приглашение", destructive: true },
    ]);
    if (picked === null) return;
    // Второе окно поверх уезжающего листа не появляется вовсе.
    await waitSheetExit();
    if (picked === 0) {
      await share();
      return;
    }
    confirmThen(
      "Отозвать приглашение?",
      {
        message: `Ссылка для ${row.email} перестанет работать.`,
        confirmLabel: "Отозвать",
        destructive: true,
      },
      async () => {
        try {
          // Уход с карточки делает `usePendingInvitation`: строка пропала.
          await revoke.mutateAsync(row.id);
        } catch (error) {
          notify("Не удалось отозвать", (error as Error).message);
        }
      },
    );
  };

  return (
    <>
      <MasterCardView
        title={draft.name.trim() || draft.email}
        subtitle={capitalizeWait(waitSubtitle(row.expires_at, new Date()))}
        onBack={back}
        headerRight={
          <HeaderMenuButton label="Действия с приглашением" onPress={() => void openMenu()} />
        }
        identity={{
          name: nameText ?? draft.name,
          email: draft.email,
          phone: formatPhoneAsYouType(draft.phone),
          title: draft.title,
          color: draft.color,
        }}
        live={false}
        editable
        cardFieldsEditable={cardFields}
        emailEditable={false}
        emailState="plain"
        onNameChange={setNameText}
        onNameCommit={commitName}
        onColorChange={cardFields ? (color) => commit({ ...draft, color }) : undefined}
        onPhoneChange={(value) => {
          const phone = phoneToSave(value);
          if (phone === undefined) {
            toast("Номер без кода страны", "error");
            return;
          }
          if ((phone ?? "") !== draft.phone) commit({ ...draft, phone: phone ?? "" });
        }}
        onTitleChange={
          cardFields
            ? (value) => {
                if (value.trim() !== draft.title) commit({ ...draft, title: value });
              }
            : undefined
        }
        teams={teams}
        teamIds={draft.teamIds}
        onOpenCalendars={() => {
          Keyboard.dismiss();
          setSheetTeamIds(draft.teamIds);
        }}
        // ТРИ КАРТОЧКИ — ОДНО ТЕЛО, ОДНИ ДАННЫЕ. Без `liveAreas` приглашение
        // рисовало все четыре раздела, включая «Календарь» и «Компанию», где
        // нет ни одного живого блока: тап открывал страницу, на которой
        // такого раздела нет вовсе.
        liveAreas={liveAreasOf(blocks, RIGHTS_AREAS)}
        areaLevels={areaLevelsOf(blocks, draft)}
        // Как у сотрудника (STORY-087): календари строками со своими правами,
        // клиенты — «Правами в компании» со сводкой словами.
        showCalendars
        calendarLine={(id) => calendarRightsLine(blocks, draft, id)}
        areaValues={{ clients: clientsRightsLine(blocks, draft) }}
        onOpenCalendarRights={(id) =>
          router.push(
            `/calendar/masters/${invitationSegment(row.id)}/rights?${rightsFocusQuery({ kind: "calendar", teamId: id })}` as Href,
          )
        }
        onOpenArea={(area) =>
          router.push(
            `/calendar/masters/${invitationSegment(row.id)}/rights?area=${area}&${rightsFocusQuery({ kind: "company" })}` as Href,
          )
        }
        footer={<GradientButton label="Отправить ещё раз" onPress={() => void share()} />}
      />
      <CalendarPickerSheet
        visible={sheetTeamIds !== null}
        teams={teams}
        selected={sheetTeamIds ?? draft.teamIds}
        // `toggleTeam` — только ради порядка и снятия id; остальное черновика
        // здесь не копится.
        onToggle={(id) =>
          setSheetTeamIds(
            (current) => toggleTeam({ ...draft, teamIds: current ?? draft.teamIds }, id).teamIds,
          )
        }
        onClose={closeCalendars}
      />
    </>
  );
}

/** Шапка карточки начинается с большой буквы. */
function capitalizeWait(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
