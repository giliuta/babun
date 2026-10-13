import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import type { Client } from "@babun/shared/local/clients";
import { useThemeColors } from "@/theme/colors";
import { PEOPLE_ON_CARD, useClientPeople } from "@/features/clients/ClientPeopleDoor";
import { useMergeDuplicate } from "@/features/clients/use-merge-duplicate";
import { useSplitClient } from "@/features/clients/use-split-client";
import { parseSplit } from "@/features/clients/split-client";
import { useClientDraft, type DraftOpen } from "@/features/clients/useClientDraft";
import { useCardAccess } from "@/features/clients/use-card-access";
import { contactsLocked } from "@/features/clients/member-contacts";
import { notify } from "@/lib/notify";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { draftReasonOf } from "./draft-reason";
import { useCardQueries } from "./use-card-queries";
import { useCardRoute } from "./use-card-route";
import { useCardSms } from "./use-card-sms";

/** All data wiring of the client card: address, server rows, the draft,
 *  rights per block, people, merge/split and the SMS context. Hooks run in
 *  the order the screen always called them. */
export function useClientCard() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const route = useCardRoute();
  const {
    id,
    prefillName,
    prefillPhone,
    openOnArrive,
    splitParam,
    teamParam,
    router,
    scope,
    caps,
    isDraft,
    draftLink,
    handBack,
  } = route;
  const queries = useCardQueries(id, isDraft, scope);
  const { client, updateClient, appointments } = queries;
  const [menuOpen, setMenuOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const {
    draft,
    updateDraft,
    duplicate,
    createError,
    e164,
    isDirty: isDraftDirty,
    canSave,
    phoneTyped: draftPhoneTyped,
    isSaving,
    onPhoneChange: onDraftPhoneChange,
    onNameChange: onDraftNameChange,
    save: saveDraft,
    isSavingNow,
  } = useClientDraft(isDraft, {
    forBooking: handBack,
    name: prefillName,
    phone: prefillPhone,
    link: draftLink,
    // «Разделить клиента»: после создания номер уходит из исходной карточки.
    split: isDraft ? parseSplit(splitParam) : null,
    // Из записи — команда записи.
    team: isDraft ? (teamParam ?? null) : null,
  });

  // Единый persist-путь для блоков: черновик — локально, карточка — PATCH.
  const update = async (patch: Partial<Client>): Promise<boolean> => {
    if (isDraft) {
      updateDraft(patch);
      return true;
    }
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      // useUpdateClient owns the actionable alert. Returning false lets an
      // inline editor keep the user's draft open instead of discarding it.
      return false;
    }
  };

  const draftReason = draftReasonOf({
    isDraft,
    duplicate,
    fullName: draft.full_name,
    e164,
    draftPhoneTyped,
  });
  // Объект, который видят блоки (черновик или серверная строка).
  const c: Client | undefined = isDraft ? draft : client ?? undefined;

  // ЛЮДИ КАРТОЧКИ, ЖИЛЬЦЫ, СТРОКА «ЧЕЙ ОН» И ДВЕРЬ СВЯЗИ — одним куском
  // (`ClientPeopleDoor.tsx`); страница только расставляет их по местам.
  // ДВЕРЬ БЛОКА В НОВОМ КЛИЕНТЕ (владелец 22.09: «при создании — те же
  // самые блоки, что у созданного»): «Добавить человека», «Добавить файл»,
  // «Записать». Всё это живёт у id карточки, которого у черновика нет, — сперва
  // создать (гейт футера), потом на карточке сразу открыть нужное.
  // ЛЮБОЙ УХОД ИЗ НАБРАННОГО ЧЕРНОВИКА СПРАШИВАЕТ (аудит 22.09): стрелка,
  // жест, аппаратная «назад» Android и «Открыть» у найденного дубля. Раньше
  // спрашивала только стрелка, а остальные пути молча выбрасывали набранное.
  // Уход после «Создать клиента» и дверей черновика не спрашивает: клиент
  // уже создан.
  const navigation = useNavigation();
  const leavingRef = useRef(false);
  usePreventRemove(isDraft && isDraftDirty, ({ data }) => {
    if (leavingRef.current || isSavingNow()) {
      navigation.dispatch(data.action);
      return;
    }
    confirmThen(
      "Удалить черновик?",
      {
        message: "Введённые данные клиента ещё не сохранены.",
        confirmLabel: "Удалить черновик",
        destructive: true,
      },
      () => {
        leavingRef.current = true;
        navigation.dispatch(data.action);
      },
    );
  });
  const onDraftDoor = (open: DraftOpen) => {
    if (!canSave) {
      haptics.warning();
      notify(draftReason ?? "Сначала заполните клиента");
      return;
    }
    void saveDraft({ open });
  };
  // Люди и связи — функция компании (STORY-088): выключены — нет ни
  // «Людей», ни «Входит в», ни жильцов объекта, ни «Разделить».
  // С 30.09 — функция КОМАНДЫ клиента.
  // С 30.09 каждый блок карточки решают вместе выключатель команды клиента
  // («Карточка клиента») и права сотрудника по блокам — `card-access.ts`.
  const access = useCardAccess(c, isDraft);
  const peopleOn = access.people.show;
  const noteOn = access.note.show;
  // «Метка» и «Тег» — два блока (03.10): ряд плиток есть, если включён хоть
  // один.
  const labelsOn = access.labels.show || access.tags.show;
  const people = useClientPeople({
    id,
    // На карточке — первые трое и дверь «Все люди · N» (владелец 22.09).
    limit: PEOPLE_ON_CARD,
    client: c,
    isDraft,
    onDraftLinks: (memberships) => updateDraft({ memberships }),
    // «Человек» в новом клиенте: сперва создать (гейт футера), потом на
    // карточке сразу «Кто это». Не хватает имени или номера — говорим, чего.
    onDraftAddPerson: () => onDraftDoor("person"),
    openPersonOnArrive: !isDraft && openOnArrive === "person",
    onArrived: () => router.setParams({ open: undefined }),
    access: access.people,
  });
  // «Объединить с дублем» в «⋯» — вся проводка в `use-merge-duplicate.ts`.
  const onMerge = useMergeDuplicate({ client: c, isDraft, canManage: caps.manage, closeMenu: () => setMenuOpen(false) });
  // «Разделить клиента» в «⋯» — вся проводка в `use-split-client.ts`.
  // «Разделить» переносит номера и связи в новую карточку: у сотрудника с
  // закрытым номером переносить нечего, пункт прятан (аудит 015, 30.09).
  const split = useSplitClient({
    client: c,
    isDraft,
    canEdit: access.card.edit && !(c && contactsLocked(c)),
    canLinks: access.people.edit,
    menuOpen,
  });
  const { stats, clientSmsContext } = useCardSms({ c, appointments, scope, access });

  return {
    ...route,
    ...queries,
    t,
    insets,
    menuOpen,
    setMenuOpen,
    remindOpen,
    setRemindOpen,
    draft,
    duplicate,
    createError,
    e164,
    isDraftDirty,
    canSave,
    isSaving,
    onDraftPhoneChange,
    onDraftNameChange,
    saveDraft,
    update,
    draftReason,
    c,
    leavingRef,
    onDraftDoor,
    access,
    peopleOn,
    noteOn,
    labelsOn,
    people,
    onMerge,
    split,
    stats,
    clientSmsContext,
  };
}

export type ClientCard = ReturnType<typeof useClientCard>;
