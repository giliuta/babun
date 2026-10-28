import { useState } from "react";
import { ScrollView } from "react-native";
import { TourTarget } from "@/components/tour/TourTarget";
import { UserPlus } from "lucide-react-native";
import { Stack } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { NavRow } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import ClientHeader from "@/features/clients/ClientHeader";
import { clientSubParams, ownClientCardHref } from "@/session/clients-company";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import { ClientLabelTags } from "@/features/clients/ClientLabelTags";
import { ClientDetailChrome } from "@/features/clients/ClientDetailChrome";
import { ClientScreenFooter } from "@/features/clients/ClientScreenFooter";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientDraftNotice } from "@/features/clients/ClientDraftNotice";
import { ClientTeamRow, ClientTeamSheet } from "@/features/clients/ClientTeamRow";
import { useSetClientTeam } from "@/features/clients/use-set-client-team";
import { useClientTeamChoices } from "@/features/clients/use-client-team-choices";
import { DuplicateNotice } from "@/features/clients/DuplicateNotice";
import { ClientProfileBlocks } from "@/features/clients/ClientProfileBlocks";
import ClientContactRow from "@/features/clients/ClientContactRow";
import { SmsComposeProvider } from "@/features/sms/SmsCompose";
import { SmsClientBlock } from "@/features/sms/SmsClientBlock";
import { deliverCreatedClient } from "@/features/appointments/pending-client";
import { notify } from "@/lib/notify";
import type { CardMenu } from "./card-menu-actions";
import { CardDataNotice } from "./CardDataNotice";
import type { ClientCard } from "./use-client-card";

/** The client card page (the draft too): chrome, blocks in their order and
 *  the draft's footer. All data comes in `card`; `menu` is the «⋯». */
export function ClientCardPage({
  card,
  c,
  menu,
}: {
  card: ClientCard;
  /** The client the blocks see — the draft or the server row. */
  c: Client;
  menu: CardMenu;
}) {
  const {
    id,
    router,
    subPage,
    pathname,
    scope,
    caps,
    isDraft,
    handBack,
    prefillName,
    prefillPhone,
    openOnArrive,
    tags,
    appointments,
    menuOpen,
    setMenuOpen,
    remindOpen,
    setRemindOpen,
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
  } = card;
  const {
    onRemind,
    onShare,
    onToggleBlacklist,
    onBack,
    partnerMenu,
    partnerDelete,
    onBookFromMenu,
    onDelete,
  } = menu;
  // «СМЕНИТЬ КОМАНДУ» — ТОЛЬКО ВЛАДЕЛЕЦ СВОЕЙ БАЗЫ и только когда есть куда:
  // варианты — живые видимые команды. Пишет дверь `set_client_team`.
  const [teamOpen, setTeamOpen] = useState(false);
  const setClientTeam = useSetClientTeam();
  const { choices: teamChoices } = useClientTeamChoices();
  const onChangeTeam =
    !isDraft && scope?.kind === "own" && teamChoices.length > 1
      ? () => {
          setMenuOpen(false);
          setTeamOpen(true);
        }
      : undefined;
  const changeTeam = (teamId: string) => {
    setClientTeam.mutate(
      { id: c.id, teamId },
      {
        onError: (e) => notify("Команда не сменилась", e instanceof Error ? e.message : undefined),
      },
    );
  };

  return (
    // Все номера страницы — клиента, его людей, доп. номера — предлагают
    // шаблоны SMS, заполненные этим клиентом (STORY-089).
    // Шаблоны и отправка с платформы — по блоку «SMS: Меняет»; без
    // него номер пишет со своего телефона, как раньше.
    <SmsComposeProvider context={access.sms.edit ? clientSmsContext : null}>
      <Stack.Screen options={{ gestureEnabled: !isDraftDirty }} />
      <Screen edges={["top"]}>
      {/* «Готово» из правого верхнего угла снесено: единственное действие
          черновика стоит внизу, в футере (`ClientScreenFooter`). */}
      <ClientDetailChrome
        draft={isDraft}
        saving={isSaving}
        menuOpen={menuOpen}
        blacklisted={c.blacklisted}
        onBack={onBack}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onRemind={() => void onRemind()}
        onBook={onBookFromMenu}
        // «Поделиться» — своя база; партнёру — с «Меню клиента».
        onShare={caps.export || partnerMenu ? () => void onShare() : undefined}
        onToggleBlacklist={onToggleBlacklist}
        onDelete={onDelete}
        // Меню то же, что у долгого нажатия в списке: имя сверху.
        menuTitle={c.full_name || c.phone || "Клиент"}
        // «Напомнить» и «В чёрный список» — своя база по праву карточки,
        // партнёр — по «Меню клиента».
        canEdit={scope?.kind === "member" ? partnerMenu : access.card.edit}
        // «Удалить» — своя база у владельца, партнёр — «Удаление клиента».
        canDelete={caps.manage || partnerDelete}
        onMerge={onMerge}
        onSplit={split.onSplit}
        onChangeTeam={onChangeTeam}
        onMenuExited={split.onMenuExited}
      />

      {/* Подъём над клавиатурой: нижние поля и «Создать клиента» не уходят
          под клавиатуру. Высоту выреза и шапки `KeyboardLift` учитывает сам. */}
      <KeyboardLift style={{ flex: 1 }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <CardDataNotice card={card} />

        {/* «НОМЕР УЖЕ ЕСТЬ» — ТИХОЙ СТРОКОЙ СВЕРХУ: дубль не даёт сдать, плашка
            видна сразу, но не вовсю. Тап — существующий клиент; «Создать клиента» погашена. */}
        {isDraft ? (
          <ClientDraftNotice
            duplicate={duplicate}
            error={createError}
            // Из записи дубль не открывают, а ВЫБИРАЮТ: это и есть тот
            // клиент, ради которого пришли.
            openLabel={handBack ? "Выбрать" : "Открыть"}
            onOpenDuplicate={(duplicateId) => {
              if (handBack) {
                // Со строкой: у партнёра клиента другой команды в списке
                // записи нет, пока запись не сохранена.
                deliverCreatedClient(duplicateId, duplicate);
                // Выбрали существующего — черновик и не нужен.
                leavingRef.current = true;
                router.back();
                return;
              }
              // Адрес — той же компании и того же стека, откуда пришли: голый
              // `/clients/<id>` при открытой в календаре чужой компании вёл в
              // «Клиент не найден», а с `/client` клал вторую копию табов.
              const card = ownClientCardHref(duplicateId, scope);
              router.replace(pathname === "/client" ? { ...card, pathname: "/client" } : card);
            }}
          />
        ) : null}

        {/* КОМАНДА НОВОГО КЛИЕНТА — ВИДНА И МЕНЯЕТСЯ ДО «СОЗДАТЬ КЛИЕНТА». */}
        {isDraft ? (
          <ClientTeamRow teamId={c.team_id ?? null} onPick={(teamId) => update({ team_id: teamId })} />
        ) : null}

        {/* ОДНА карточка-идентичность на оба режима: в черновике те же
            поля пустые (телефон с автофокусом и ✓), «Из контактов» вместо
            бейджей, слот дедупа под номером. */}
        {/* key по id — обязателен. Экран /clients/[id] переиспользуется при
            смене параметра (дедуп «Открыть», переход на дубль, deep link), и
            без ключа локальное состояние строк переживает смену клиента:
            набранный, но не сохранённый номер закоммитился бы в ДРУГОГО
            клиента при уходе фокуса. */}
        {/* МЕТКА И ТЕГ — САМЫМ ВЕРХОМ, ПЕРЕД БЛОКОМ «КЛИЕНТ», а не внизу, у
            «Личного». */}
        {labelsOn ? (
          <ClientLabelTags
            client={c}
            appointments={appointments}
            update={update}
            tags={tags}
            readOnly={!access.labels.edit}
            // Выключенная командой метка не запирает тег.
            tagReadOnly={!access.tags.edit}
            labelOn={access.labels.show}
            tagOn={access.tags.show}
          />
        ) : null}

        <ClientHeader
          key={`header-${id}`}
          client={c}
          update={update}
          readOnly={!access.card.edit}
          // Без передачи: клиента чужой компании не
          // скопировать ни долгим нажатием, ни из поля.
          noCopy={!isDraft && !caps.export}
          // «Входит в карточку Павла · жена» — это связь, а связи и роли живут
          // в блоке «Люди» (роли в блоке клиента не назначаем). В шапке
          // клиента — только он сам и его контакты. Заметка клиента — вторым
          // блоком, под «Клиентом».
          note={
            noteOn ? (
              <NotesBlock client={c} update={update} readOnly={!access.note.edit} live={isDraft} />
            ) : null
          }
          people={
            peopleOn && (people.peopleRows || people.onAddPerson || people.memberOfRows) ? (
              <SectionCard title="Люди">
                {people.memberOfRows}
                {people.peopleRows}
                {people.peopleHidden > 0 ? (
                  <NavRow
                    label="Все люди"
                    value={String(people.peopleTotal)}
                    separated
                    onPress={() =>
                      router.push({
                        pathname: subPage("people"),
                        params: clientSubParams(id, scope),
                      })
                    }
                  />
                ) : null}
                {people.onAddPerson ? (
                  <ChooseRow
                    compact
                    icon={UserPlus}
                    label="Добавить человека"
                    onPress={people.onAddPerson}
                  />
                ) : null}
              </SectionCard>
            ) : null
          }
          draft={
            isDraft
              ? {
                  // Галка — «номер годится». Номер другого клиента не
                  // годится: сохранить его нельзя, плашка и футер это уже
                  // говорят, и зелёная галка рядом им противоречила.
                  valid: e164 !== null && !duplicate,
                  // Вставка «имя + номер» делится: номер — в телефон.
                  onNameChange: onDraftNameChange,
                  onPhoneChange: onDraftPhoneChange,
                  // КУРСОР — В ПЕРВОЕ ПУСТОЕ ПОЛЕ СВЕРХУ ВНИЗ: сначала имя.
                  // Курсор в номере под пустым именем начинал бы страницу
                  // «снизу». Имя уже пришло из поиска — в номер.
                  focus: prefillName && !prefillPhone ? "phone" : "name",
                }
              : undefined
          }
        />

        {/* Действия уровня человека. В черновике строка видна, но пригашена
            с подписью «Записать можно после сохранения» — владелец требует
            видеть страницу целиком, а мёртвого тапа быть не должно.
            */}
        {/* Дубли ищутся не только при создании: карточка живёт годами, а
            второй «тот же человек» заводится позже — импортом или звонком с
            другого номера. */}
        {/* Слияние дублей двигает записи через активный календарь — у клиента
            чужой компании этой дороги нет. */}
        {!isDraft && caps.manage ? <DuplicateNotice client={c} /> : null}

        <ClientContactRow
          client={c}
          stats={stats}
          draft={isDraft}
          // «История» и «Долг и деньги» — права сотрудника по блокам.
          showSummary={access.history.show}
          showMoney={access.money.show}
          appointments={appointments}
          // Сводка в блоке «История» = вход в перечень записей. Записей нет — вести
          // некуда, и сводка остаётся просто текстом (мёртвых тапов не держим).
          // История открыта и сотруднику — по праву «История
          // записей» этого клиента (`card-access.ts`).
          onOpenHistory={
            !isDraft && access.history.show && appointments.length > 0
              ? () => {
                  router.push({
                    pathname: subPage("visits"),
                    params: clientSubParams(id, scope),
                  });
                }
              : undefined
          }
        />

        <ClientProfileBlocks
          key={`blocks-${id}`}
          client={c}
          appointments={appointments}
          draft={isDraft}
          update={update}
          // Какие блоки видны и правятся — одним ответом (`card-access.ts`).
          access={access}
          // Длинные списки — своими страницами, как история записей.
          onOpenObjects={() =>
            router.push({ pathname: subPage("objects"), params: clientSubParams(id, scope) })
          }
          onOpenRequisites={() =>
            router.push({ pathname: subPage("requisites"), params: clientSubParams(id, scope) })
          }
          onDraftFiles={() => onDraftDoor("files")}
          openFilesOnArrive={!isDraft && openOnArrive === "files"}
          onArrived={() => router.setParams({ open: undefined })}
          // ЖИЛЬЦЫ: под объектом на странице — показание, в листе объекта —
          // строки с ролью и единственная дверь заведения.
          {...(peopleOn ? people.residents : {})}
        />

        {/* SMS КЛИЕНТУ ОДНИМ БЛОКОМ (STORY-089): «Присылать
            SMS», «Имя для SMS» и все сообщения — на какой номер ушло.
            Отправка — в кнопке номера. */}
        {!isDraft && access.sms.show ? (
          <SmsClientBlock client={c} update={update} readOnly={!access.sms.edit} />
        ) : null}
      </ScrollView>

      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ, ПОД ПАЛЬЦЕМ, ВНЕ ПРОКРУТКИ.
          У сохранённой карточки футера НЕТ: контактная база не имеет одного
          действия, «Записать» понижена самим владельцем до обычной строки, а
          «Готово», которое ничего не пишет, дублировало бы стрелку «назад». */}
      {isDraft ? (
        <TourTarget id="client.create-submit" shape="control">
          <ClientScreenFooter
            label="Создать клиента"
            reason={draftReason}
            disabled={!canSave}
            onPress={() => void saveDraft()}
            // `/client` открыт поверх записи, вне вкладок — там таб-бара нет.
            overTabBar={pathname !== "/client"}
          />
        </TourTarget>
      ) : null}
      </KeyboardLift>

      <ClientTeamSheet
        visible={teamOpen}
        teamId={c.team_id ?? null}
        onPick={changeTeam}
        onClose={() => setTeamOpen(false)}
      />
      <RemindSheet
        visible={remindOpen}
        clientName={c.full_name}
        hasReminder={!!c.reminder_at}
        onPick={(reminder_at) => update({ reminder_at })}
        onClose={() => setRemindOpen(false)}
      />

      {people.door}
      {split.sheet}
    </Screen>
    </SmsComposeProvider>
  );
}
