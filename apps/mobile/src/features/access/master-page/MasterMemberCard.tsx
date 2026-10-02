import { useRef, useState } from "react";
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
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import { useMasters, useTeams, useUpdateMaster } from "@/features/reference/queries";
import { useRemoveTenantMember } from "@/features/settings/team-access";
import { chooseOption } from "@/lib/choose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

import { levelOf as mapLevelOf, type AccessBlock, type AccessRefusal } from "../access-map";
import { waitSheetExit } from "../InviteMemberSheet";
import {
  useAccessBlocks,
  useCompanyMembers,
  useMemberAccess,
  useSetMemberAccess,
  useSetMemberCalendars,
} from "../queries";
import { removalMessage, upcomingWorkCount } from "./removal-impact";
import { draftTeamBrief } from "../rights-ui/team-sentence";
import { AccessSectionsCard } from "../rights-ui/AccessSectionsCard";
import { MasterPersonalBlocks, MasterWorkBlock } from "./MasterProfileBlocks";
import { EmployeeNoteBlock } from "./EmployeeNoteBlock";
import { contactsHolderOf, useMasterProfileWrite } from "./use-profile-write";
import { rightsFocusQuery } from "./rights-focus";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { CalendarPickerSheet } from "./CalendarPickerSheet";
import { CALENDAR_GROUPS } from "./access-summary";
import { ContactJournalBlock } from "./ContactJournalBlock";
import { activeOf, usePreview } from "./rights-page-shared";
import { memberRefusal } from "./member-rights-writer";
import { viewSections } from "./rights-view-sections";
import { HeaderMenuButton, MasterCardView } from "./MasterCardView";
import {
  copyCalendarLevels,
  starterCalendarChanges,
  visibleLevel,
  withLiveTeams,
} from "./master-draft";
import {
  MEMBER_REFUSAL_TEXT,
  areaLevelsOf,
  companyAreasOf,
  draftFromMemberAccess,
} from "./rights-rows";

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

export function MasterMemberCard({
  userId,
  teamId,
  onBack,
}: {
  userId: string;
  teamId: string | null;
  onBack: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const teamsQuery = useTeams();
  const blocksQuery = useAccessBlocks({ fresh: true });
  const accessQuery = useMemberAccess(userId);
  const membersQuery = useCompanyMembers();
  const mastersQuery = useMasters({ includeInactive: true });
  // Записи компании уже греются календарём — счёт берётся из того же кэша.
  const appts = useAppointments();
  const businessNow = useBusinessNow();
  const updateMaster = useUpdateMaster();
  const remove = useRemoveTenantMember();
  const setCalendars = useSetMemberCalendars(userId);
  const setAccess = useSetMemberAccess(userId);
  const preview = usePreview();
  const [nameText, setNameText] = useState<string | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
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
    phone: formatPhoneAsYouType(card?.phone ?? member?.phone ?? ""),
    title: card?.title ?? "",
    color: card?.color ?? null,
  };
  // Архивный календарь в слове раздела не считается — как на странице прав.
  const draft = withLiveTeams(
    draftFromMemberAccess(accessQuery.data, identity),
    new Set(teams.map((team) => team.id)),
  );
  // База клиентов открыта хоть в одной команде — номер он открывает (02.10:
  // «Телефон» убран), и блок «Номера клиентов» нужен и пустым: «Пока не
  // открывал».
  const contactsBlock = blocks?.find((block) => block.key === "clients");
  const contactsOpen =
    !!blocks &&
    !!contactsBlock &&
    draft.teamIds.some((id) => visibleLevel(blocks, draft)(contactsBlock, id) !== "off");


  /** Прикрепить или открепить календарь. Открепление спрашивает словами: в
   *  этом календаре человек разом теряет и записи, и деньги, и права — их
   *  уровни там больше не считаются. */
  const toggleCalendar = async (id: string) => {
    const current = draft.teamIds;
    const attached = current.includes(id);
    const next = attached ? current.filter((teamId) => teamId !== id) : [...current, id];
    // ЖДЁМ ОТВЕТ ПРЯМО (`mutateAsync`), а не обратным вызовом `mutate`:
    // ответ перерисовывает карточку, и обратный вызов прежнего нажатия
    // react-query молча не зовёт — вопрос про права не появлялся (снято
    // 23.09 на симуляторе).
    const save = async (): Promise<boolean> => {
      try {
        await setCalendars.mutateAsync(next);
        return true;
      } catch (error) {
        toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
        return false;
      }
    };
    if (!attached) {
      // НОВЫЙ КАЛЕНДАРЬ — СПРОСИТЬ, КАК В КАКОМ (STORY-087; владелец 23.09:
      // «в каждый календарь буду добавлять одного и того же мастера»). В новом
      // календаре у человека всё «Не видит»; чаще всего нужны те же права,
      // что уже стоят в его первом календаре, — одним тапом, без десяти строк.
      const source = current.find((teamId) => teamNameOf(teamId));
      if (!(await save())) return;
      // Новая команда сразу выбрана в ленте: её права ставятся прямо здесь.
      setActiveTeam(id);
      // Стартовые права нового календаря (владелец 24.09): без них человек
      // входил в календарь и не видел в нём даже своей работы.
      const applyStarter = async () => {
        const changes = starterCalendarChanges(blocks, id);
        if (changes.length === 0) return;
        try {
          await setAccess.mutateAsync(changes);
        } catch (error) {
          toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
        }
      };
      // Шаблонов доступа больше нет (владелец 30.09: «этот блок полностью
      // убери… по сути вот эти шаблоны»): вопрос — «как в …» или сам.
      if (!source) {
        await applyStarter();
        return;
      }
      // ВОПРОС — КОГДА ЛИСТ КАЛЕНДАРЕЙ УЖЕ СНЯТ. Два нижних листа iOS подряд
      // не показывает: вопрос, поднятый по таймеру, пока лист ещё уезжал,
      // молча терялся (снято 23.09). Ждём `onExited` самого листа.
      await closeCalendarsSheet();
      const sourceName = source ? (teamNameOf(source) ?? "первом календаре") : "";
      const targetName = teamNameOf(id) ?? "новом календаре";
      const answer = await chooseOption(`Права в «${targetName}»`, [
        { label: `Как в «${sourceName}»` },
        { label: "Выставлю сам" },
      ]);
      if (answer === 0) {
        try {
          await setAccess.mutateAsync(copyCalendarLevels(blocks, draft, source, id));
          toast(`Права как в «${sourceName}»`);
        } catch (error) {
          toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
        }
      } else {
        // «Выставлю сам» и закрытый вопрос — со стартовых прав.
        await applyStarter();
      }
      return;
    }
    // УБИРАЕМ СРАЗУ, С «ОТМЕНИТЬ» (владелец 22.09: «всё можно вот так вот
    // убирать» — свайпом, без вопроса). Права в этом календаре уходят вместе
    // с ним (каскад на сервере), поэтому «Отменить» возвращает и календарь, и
    // его положения — из снимка до ухода.
    const teamName = teamNameOf(id) ?? "календаря";
    const restoreLevels = copyCalendarLevels(blocks, draft, id, id);
    setCalendarsOpen(false);
    if (!(await save())) return;
    toast(`Убран из «${teamName}»`, "success", {
      label: "Отменить",
      onPress: () =>
        void setCalendars
          .mutateAsync(current)
          .then(() => setAccess.mutateAsync(restoreLevels))
          .catch((error) => toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error")),
    });
  };

  // ПРАВА ВЫБРАННОЙ КОМАНДЫ — ПРЯМО НА СТРАНИЦЕ (владелец 29.09: «захожу в
  // календарь команда один, и там полностью все настройки по каждому»). Тот
  // же набор, что был на отдельной странице команды, плюс права компании.
  // Без команды из адреса — первая в ленте, а она идёт порядком команд.
  const activeId = activeOf(
    activeTeam,
    teams.filter((team) => draft.teamIds.includes(team.id)).map((team) => team.id),
  );
  const activeTeamRow = teams.find((team) => team.id === activeId) ?? null;
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
  // «Убрать из компании», а не «из календаря»: членство одно на компанию, а
  // открепить от одного календаря приложение ещё не умеет. Слово не обещает
  // меньше, чем будет.
  // ⋯ — ТО, ЧЕГО НЕТ В БЛОКАХ СТРАНИЦЫ (STORY-087): архив карточки и уход из
  // компании. «Посмотреть его глазами» переехало строкой в блок «Доступ».
  const openMenu = async () => {
    if (!member) return;
    Keyboard.dismiss();
    const options = [
      ...(card
        ? [
            {
              label: card.is_active ? "В архив" : "Вернуть из архива",
              run: () => {
                patchCard({ is_active: !card.is_active });
                toast(card.is_active ? "Мастер в архиве — в выборе команды его нет" : "Мастер снова в работе");
              },
            },
          ]
        : []),
    ];
    const picked = await chooseOption(member.name, [
      ...options.map((option) => ({ label: option.label })),
      { label: "Убрать из компании", destructive: true },
    ]);
    if (picked === null) return;
    if (picked < options.length) {
      options[picked].run();
      return;
    }
    await waitSheetExit();
    confirmThen(
      `Убрать ${member.name} из компании?`,
      {
        // ВОПРОС НАЗЫВАЕТ ЦИФРУ. Владельца держит не «пропадёт доступ», а то,
        // что на четверг у человека три выезда: убрал в среду — узнал от
        // клиента (`removal-impact.ts`).
        message: removalMessage(
          upcomingWorkCount(appts.data ?? [], draft.teamIds, businessNow().ymd),
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
        title={name || member?.email || "Партнёр"}
        onBack={back}
        headerRight={
        member && isStaff ? (
          <HeaderMenuButton label="Действия с партнёром" onPress={() => void openMenu()} />
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
        teams={teams}
        teamIds={draft.teamIds}
        onOpenCalendars={() => {
        Keyboard.dismiss();
        setCalendarsOpen(true);
        }}
        liveAreas={companyAreasOf(blocks)}
        showCalendars
        areaLevels={areaLevelsOf(blocks, draft)}
        // Права компании (клиенты) — своей страницей; календарные живут в
        // строках календарей (STORY-087).
        onOpenArea={(area) =>
          router.push(
            `/cabinet/people/access/${userId}?team=${encodeURIComponent(teamId ?? "")}&rights=1&area=${area}&${rightsFocusQuery({ kind: "company" })}` as Href,
          )
        }
        // У КАЖДОГО КАЛЕНДАРЯ СВОИ ПРАВА (владелец 23.09): строка календаря
        // говорит, что человек может в НЁМ, и открывает права этого календаря.
        teamLine={(id) => draftTeamBrief(blocks, draft, id)}
        // «Посмотреть его глазами» — строкой в блоке «Доступ», а не в ⋯.
        onMirror={() =>
          preview({ blocks, draft, name, userId })
        }
        onOpenCalendarRights={(id) =>
          router.push(
            `/cabinet/people/access/${userId}?team=${encodeURIComponent(teamId ?? id)}&rights=1&${rightsFocusQuery({ kind: "calendar", teamId: id })}` as Href,
          )
        }
        onDetachCalendar={(id) => void toggleCalendar(id)}
        phoneAction={
          identity.phone ? <PhoneChannelButton number={card?.phone ?? member?.phone ?? ""} label={name} /> : undefined
        }
        contacts={
          card
            ? { holder: contactsHolderOf(profileWrite.profile), update: profileWrite.writeContacts }
            : undefined
        }
        note={card ? <EmployeeNoteBlock card={card} /> : undefined}
        teamChips={{
          activeId,
          onSelect: setActiveTeam,
          onAdd: () => {
            Keyboard.dismiss();
            setCalendarsOpen(true);
          },
        }}
        teamRights={
          // ДОСТУП — ПОСТРАНИЧНО (владелец 29.09): строка раздела, тап —
          // страница со всеми его правами в выбранной команде. Карточки
          // «Итог» с «Шаблоном» над ним больше нет (владелец 30.09: «этот
          // блок полностью убери, он не нужен»).
          <AccessSectionsCard
            sections={rightsSectionsNow}
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
        footer={<GradientButton label="Посмотреть его глазами" onPress={() => preview({ blocks, draft, name, userId })} />}
      >
        {card ? (
          <>
            <MasterWorkBlock card={card} teamIds={draft.teamIds} />
            {/* Кому и когда он открывал номера (защита базы 30.09). */}
            <ContactJournalBlock userId={userId} contactsOpen={contactsOpen} />
            <MasterPersonalBlocks card={card} />
          </>
        ) : null}
      </MasterCardView>
      <CalendarPickerSheet
        visible={calendarsOpen}
        teams={teams}
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
