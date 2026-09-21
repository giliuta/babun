import { useRef, useState } from "react";
import { Keyboard, Pressable, View, type TextInput } from "react-native";
import { Stack, useRouter, type Href } from "expo-router";

import { GradientButton } from "@/components/ui/GradientButton";
import { useToast } from "@/components/ui/Toast";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import { useTeams } from "@/features/reference/queries";
import { isInvitationEmail } from "@/features/settings/invitation-flow";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";

import { useAccessBlocks } from "../queries";
import { CalendarPickerSheet } from "./CalendarPickerSheet";
import {
  closeMasterDraft,
  openMasterDraft,
  updateMasterDraft,
  useMasterDraft,
} from "./draft-store";
import { useCreateMasterInvitation } from "./invitation-api";
import { invitationRefusalText, isEmailRefusal } from "./invitation-contract";
import { MasterCardView, type EmailState } from "./MasterCardView";
import { MasterInviteCard } from "./MasterInviteCard";
import { MasterMemberCard } from "./MasterMemberCard";
import {
  invitationRequest,
  invitationSegment,
  inviteBlockers,
  isDraftDirty,
  toggleTeam,
  type MasterDraft,
} from "./master-draft";
import { RIGHTS_AREAS, areaLevelsOf, liveAreasOf } from "./rights-rows";

// КАРТОЧКА МАСТЕРА — ОДНА НА ТРИ СЛУЧАЯ (владелец 15.09: «„Добавить мастера"
// должен сразу открывать полную страницу мастера, как добавление клиента»).
// Как у клиента, создание и жизнь — одна карточка с режимом (AGENTS, Canon
// Reuse п.2), а не три похожих экрана:
//   • draft  — `new?team=`: черновик до «Пригласить»;
//   • invite — `invite-<uuid>`: приглашение без ответа, правится на месте;
//   • member — `access/[userId]`: человек уже в календаре.
// Тело одно (`MasterCardView`); режим решает, откуда данные и куда правка.

export type MasterCardProps =
  | { mode: "draft"; teamId: string | null; onBack: () => void }
  | { mode: "invite"; invitationId: string; onBack: () => void }
  | { mode: "member"; userId: string; teamId: string | null; onBack: () => void };

export function MasterCard(props: MasterCardProps) {
  switch (props.mode) {
    case "invite":
      return <MasterInviteCard invitationId={props.invitationId} onBack={props.onBack} />;
    case "member":
      return (
        <MasterMemberCard userId={props.userId} teamId={props.teamId} onBack={props.onBack} />
      );
    default:
      return <MasterDraftCard teamId={props.teamId} onBack={props.onBack} />;
  }
}

function MasterDraftCard({
  teamId,
  onBack,
}: {
  teamId: string | null;
  onBack: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const teams = useTeams().data ?? [];
  const blocksQuery = useAccessBlocks();
  const blocks = blocksQuery.data;
  const create = useCreateMasterInvitation();
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  // Адрес, который отказал сервер: красный, пока его не поправили.
  const [refusedEmail, setRefusedEmail] = useState<string | null>(null);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  // Черновик общий со страницей «Права» (`draft-store`). После «Пригласить» и
  // «Удалить черновик» экран ещё уезжает — держим последний вид, чтобы поля
  // не мигнули пустыми.
  const [opened] = useState(() => openMasterDraft(teamId));
  const current = useMasterDraft();
  const last = useRef(opened);
  if (current) last.current = current;
  const draft = last.current.draft;

  const update = (patch: Partial<MasterDraft>) =>
    updateMasterDraft((currentDraft) => ({ ...currentDraft, ...patch }));
  const blockers = inviteBlockers(draft, {
    isEmail: isInvitationEmail,
    isPhone: (value) => phoneToSave(value) !== undefined,
  });
  const blocked = blockers.length > 0;
  // Серая по двум причинам: чего-то не хватает — или реестр прав ещё не
  // пришёл, и права ушли бы пустыми.
  const grey = blocked || !blocks;
  const dirty = isDraftDirty(draft, teamId);
  const emailRefused = refusedEmail !== null && draft.email === refusedEmail;
  const emailState: EmailState =
    isInvitationEmail(draft.email) && !emailRefused
      ? "valid"
      : emailRefused || (emailTouched && draft.email.trim() !== "")
        ? "invalid"
        : "plain";

  // «Назад» живёт выше прокрутки и фокус у поля не забирает: клавиатура
  // снимается первой, чтобы набранное успело лечь в черновик.
  const leave = () => {
    Keyboard.dismiss();
    // Приглашение уже в пути: уход не отменит запрос на сервере, а только
    // потеряет его ответ — строка появится в списке без тоста. Ждём ответа.
    if (create.isPending) return;
    const close = () => {
      closeMasterDraft();
      onBack();
    };
    if (!dirty) {
      close();
      return;
    }
    confirmThen("Удалить черновик?", { confirmLabel: "Удалить", destructive: true }, close);
  };

  const openArea = (area: string) =>
    router.push(
      `/calendar/masters/new/rights?area=${area}&team=${encodeURIComponent(teamId ?? "")}` as Href,
    );

  // СЕРАЯ КНОПКА НЕ МОЛЧИТ И НЕ ОБЪЯСНЯЕТ СЛОВАМИ: тап отзывается вибрацией и
  // ведёт к первому, чего не хватает, — в порядке полей на странице.
  const nudge = () => {
    haptics.warning();
    if (!blocked) {
      // Всё заполнено, но реестра прав нет: просим его снова. Не пришёл с
      // ошибкой — ведём на «Права», там отказ словами и «Повторить».
      Keyboard.dismiss();
      void blocksQuery.refetch();
      if (blocksQuery.isError) openArea(RIGHTS_AREAS[0] ?? "calendar");
      return;
    }
    const first = blockers[0];
    if (first === "calendar") {
      Keyboard.dismiss();
      setCalendarsOpen(true);
      return;
    }
    const target = first === "name" ? nameRef : first === "email" ? emailRef : phoneRef;
    target.current?.focus();
  };

  const invite = () => {
    Keyboard.dismiss();
    if (blocked) {
      nudge();
      return;
    }
    // Без реестра блоков права ушли бы пустыми — кнопка до него серая.
    if (!blocks || create.isPending) return;
    create.mutate(invitationRequest(draft, blocks, phoneToSave), {
      onSuccess: (saved) => {
        haptics.success();
        toast("Приглашение отправлено");
        closeMasterDraft();
        // Не «назад», а сразу карточка приглашения: владелец видит то, что
        // только что отправил, и может поправить до ответа.
        router.replace(`/calendar/masters/${invitationSegment(saved.id)}` as Href);
      },
      onError: (error) => {
        toast(invitationRefusalText(error), "error");
        if (isEmailRefusal(error.message)) setRefusedEmail(draft.email);
      },
    });
  };

  const checkPhone = () => {
    if (draft.phone.trim() && phoneToSave(draft.phone) === undefined) {
      toast("Номер без кода страны", "error");
    }
  };

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !dirty && !create.isPending }} />
      <MasterCardView
        title="Новый мастер"
        onBack={leave}
        identity={draft}
        live
        editable
        emailEditable
        autoFocusName
        emailState={emailState}
        refs={{ name: nameRef, email: emailRef, phone: phoneRef }}
        onNameChange={(name) => update({ name })}
        onColorChange={(color) => update({ color })}
        onEmailChange={(value) => {
          setEmailTouched(false);
          update({ email: value.trim() });
        }}
        onEmailEditEnd={() => setEmailTouched(true)}
        // Стирание не форматируем, как в черновике клиента: AsYouType тут же
        // возвращает стёртый пробел или скобку, а курсор уезжает в конец
        // номера. Сравниваем с черновиком из обновления, а не с отрисованным:
        // два быстрых символа подряд меряются по новейшему значению.
        onPhoneChange={(value) =>
          updateMasterDraft((currentDraft) => ({
            ...currentDraft,
            phone:
              value.length < currentDraft.phone.length ? value : formatPhoneAsYouType(value),
          }))
        }
        onPhoneEditEnd={checkPhone}
        onTitleChange={(title) => update({ title })}
        teams={teams}
        teamIds={draft.teamIds}
        onOpenCalendars={() => {
          Keyboard.dismiss();
          setCalendarsOpen(true);
        }}
        liveAreas={blocks ? liveAreasOf(blocks, RIGHTS_AREAS) : []}
        areaLevels={blocks ? areaLevelsOf(blocks, draft) : null}
        onOpenArea={openArea}
        footer={
          // Серая кнопка — чего-то не хватает или реестр прав не пришёл — сама
          // тапов не ловит: их ловит обёртка, чтобы отозваться и повести к
          // недостающему, а не молчать.
          <Pressable onPress={grey ? nudge : undefined} disabled={!grey} accessible={false}>
            <View pointerEvents={grey ? "none" : "auto"}>
              <GradientButton
                label="Пригласить"
                onPress={invite}
                disabled={grey}
                loading={create.isPending}
              />
            </View>
          </Pressable>
        }
      />
      <CalendarPickerSheet
        visible={calendarsOpen}
        teams={teams}
        selected={draft.teamIds}
        onToggle={(id) => updateMasterDraft((currentDraft) => toggleTeam(currentDraft, id))}
        onClose={() => setCalendarsOpen(false)}
      />
    </>
  );
}
