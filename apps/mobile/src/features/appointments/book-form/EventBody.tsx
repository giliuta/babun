import { UserRound, Users } from "lucide-react-native";
import { InlineNoteField } from "@/components/blocks/InlineNoteField";
import { AppointmentFilesBlock } from "@/features/appointments/AppointmentFilesBlock";
import { EventTypeBlock } from "@/features/appointments/EventTypeBlock";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { TeamLabelRow } from "@/components/blocks/TeamLabelRow";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { minutesBetweenHM } from "@/features/appointments/helpers";
import { SmsComposeProvider } from "@/features/sms/SmsCompose";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import { KEYBOARD_SETTLE_MS } from "./book-constants";
import { inOrder } from "./in-order";
import { EventObjectBlock } from "./EventObjectBlock";
import type { BookModel } from "./use-book-form";

/** ── Событие ── team and label, time, then the event's blocks in order. */
export function EventBody({ form }: { form: BookModel }) {
  const {
    t,
    teamId,
    team,
    effectiveLabel,
    teamCities,
    city,
    evShowLabel,
    can,
    setEventTeamSheetOpen,
    setLabelSheetOpen,
    date,
    timeStart,
    timeEnd,
    slotFallback,
    workWarning,
    setWhenOpen,
    eventBlocks,
    evShowType,
    eventType,
    eventTitle,
    eventColor,
    setEventTypeSheetOpen,
    evShowClient,
    workInPlan,
    client,
    recordSmsContext,
    clientStats,
    pickClientOrRefuse,
    openClientCard,
    setClientId,
    setLocationId,
    clientNoteOn,
    clientNote,
    clientNoteWritable,
    evShowNote,
    eventNotes,
    setEventNotes,
    scrollRef,
    evShowFiles,
    editing,
    locationId,
    status,
    isMemberView,
    pendingFiles,
    setPendingFiles,
  } = form;
  return (
    <>
      {/* ТА ЖЕ ЛЕСТНИЦА, ЧТО У ЗАПИСИ: команда и метка одной строкой,
          время, ТИП, клиент, объект, заметка, файлы. Без услуг и
          оплаты, без названия («событие называется типом»), без
          «весь день», повтора и напоминания.
          «Личное» — событие без команды, как и было.

          ВТОРАЯ ПЛИТКА ШАПКИ — МЕТКА, А НЕ ТИП (владелец 2026-09-08:
          «вот этот вот тип, что справа вверху, переделай его на метку,
          как в клиентах, а ниже под временем сделаем новый блок —
          тип события»). Пока тип стоял здесь, у нового события это
          был серый кружок со словом «Тип» — самое тихое место экрана
          на месте, где у записи горит метка выезда. Метка у события и
          у записи теперь одна и та же вещь: та же библиотека Кабинета,
          тот же лист, та же колонка `city`. */}
      <TeamLabelRow
        teamName={teamId == null ? "Личное" : team?.name ?? "Команда"}
        teamColor={teamId == null ? t.accent : team?.color ?? t.accent}
        teamIcon={teamId == null ? UserRound : Users}
        label={effectiveLabel}
        labelColor={
          teamCities.find((c) => c.name === effectiveLabel)?.color ?? null
        }
        labelFromDay={city == null}
        showLabel={evShowLabel && can.showLabel}
        onEditTeam={
          can.editTeam
            ? () => {
                setEventTeamSheetOpen(true);
                haptics.tap();
              }
            : undefined
        }
        onEditLabel={
          can.editLabel
            ? () => {
                setLabelSheetOpen(true);
                haptics.tap();
              }
            : undefined
        }
      />

      <WhenRow
        date={date}
        timeStart={timeStart}
        timeEnd={timeEnd}
        duration={minutesBetweenHM(timeStart, timeEnd) || slotFallback}
        warning={workWarning}
        onPress={
          can.editWhen
            ? () => {
                setWhenOpen(true);
                haptics.tap();
              }
            : undefined
        }
      />
      {/* ТЕЛО СОБЫТИЯ — В ПОРЯДКЕ КОМАНДЫ, как у записи (`useEventBlocks`). */}
      {inOrder(eventBlocks, {
        type: (
          <>
            {/* ТИП СОБЫТИЯ — ПОД ВРЕМЕНЕМ (владелец 2026-09-06 завёл его
                здесь; 2026-09-08 я поднял блок выше, и владелец вернул:
                «нет, я неправильно объяснил — опусти на один блок ниже,
                время обратно»). Тот же блок, что «Категория» в финансах:
                строка-дверь → шторка. Цвет события и есть цвет типа. */}
            {/* Без права править событие тип только читается: пустую дверь
                «Выбрать тип» не показываем, выбранный — без действия. */}
            {evShowType && can.showType && (can.editEventType || eventType || eventTitle.trim()) ? (
              <EventTypeBlock
                type={eventType}
                title={eventTitle}
                titleColor={eventColor}
                onPress={
                  can.editEventType
                    ? () => {
                        setEventTypeSheetOpen(true);
                        haptics.tap();
                      }
                    : () => {}
                }
              />
            ) : null}
          </>
        ),
        client: (
          <>
            {/* КЛИЕНТ — НЕОБЯЗАТЕЛЕН: событие бывает и без человека, поэтому
                у выбранного есть «убрать» — лист выбора пустого варианта не
                предлагает. */}
            {/* БЛОК «КЛИЕНТ» ЖИВЁТ ОТДЕЛЬНО (`features/appointments/ClientBlock.tsx`):
                его же ставит составитель чека. До 2026-09-20 разметка стояла здесь
                ДВАЖДЫ — своя у записи, своя у события, — и копии уже разошлись. */}
            {/* БЕЗ ТАРИФА КЛИЕНТОВ НЕТ (владелец 04.10: «зачем этот блок, если
                клиента я не могу добавлять без тарифа»): блока нет; уже
                выбранный прежде клиент остаётся виден. */}
            {evShowClient && can.showClient && (workInPlan || client) ? (
              <SmsComposeProvider context={recordSmsContext}>
                <ClientBlock
                  client={client}
                  stats={clientStats}
                  onPick={can.editClient ? pickClientOrRefuse : undefined}
                  onOpenCard={openClientCard}
                  onClear={
                    can.editClient
                      ? () => {
                          setClientId(null);
                          setLocationId(null);
                        }
                      : undefined
                  }
                  note={
                    clientNoteOn ? (
                      <InlineNoteField
                        note={clientNote}
                        placeholder="Заметка клиента"
                        accessibilityLabel="Заметка клиента"
                        maxLength={500}
                        readOnly={!clientNoteWritable}
                      />
                    ) : undefined
                  }
                />
              </SmsComposeProvider>
            ) : null}
          </>
        ),
        object: (
          <>
            <EventObjectBlock form={form} />
          </>
        ),
        note: (
          <>
            {/* ЗАМЕТКА СОБЫТИЯ — ТО ЖЕ ПОЛЕ, ЧТО ЗАМЕТКА КЛИЕНТА, ЦЕЛИКОМ
                (владелец 2026-09-10, вторым заходом: «уменьши заметки,
                сделай такие заметки, как в клиентах… короче, сделай то же
                самое, как в клиентах»). Первый заход сделал общим только
                материал — плашку `t.fill`, кегль 13/18, отступы, — а высоту
                оставил свою (`tall`, четыре строки вместо одной) по просьбе
                2026-09-08 «дай заметке события больше места». Полумера и
                вернулась вопросом: одинаково — значит и по высоте.

                ПОДСКАЗКА НАЗЫВАЕТ ПОЛЕ (та же просьба: «добавь в подсказку
                заметка записи»). Пустое поле без подсказки читалось как
                пустое место; имя берётся у сущности — «Заметка события»,
                как «Заметка клиента» у клиента, — а шапка блока остаётся. */}
            {evShowNote && can.showNote ? (
              <SectionCard title="Заметка">
                <InlineNoteField
                  note={{
                    draft: eventNotes,
                    setDraft: setEventNotes,
                    onFocus: () =>
                      setTimeout(
                        () => scrollRef.current?.scrollToEnd({ animated: true }),
                        KEYBOARD_SETTLE_MS,
                      ),
                    onBlur: () => {},
                  }}
                  placeholder="Заметка события"
                  rows={3}
                  accessibilityLabel="Заметка события"
                  readOnly={!can.editNote}
                />
              </SectionCard>
            ) : null}
          </>
        ),
        files: (
          <>
            {/* ФАЙЛЫ СОБЫТИЯ — ТОТ ЖЕ БЛОК, ЧТО У ЗАПИСИ (владелец
                2026-09-08: «сделай блок добавления файлов; по сути событие
                это точно такое же, только без услуги и оплаты»). У события
                без клиента документы не заводятся — их место карточка
                клиента, — а фото и сканы живут на самом событии. */}
            {evShowFiles && can.showFiles ? (
              <AppointmentFilesBlock
                appointmentId={editing?.id ?? null}
                clientId={editing?.client_id ?? client?.id ?? null}
                locationId={editing?.location_id ?? locationId ?? null}
                canUpload={status !== "cancelled" && can.editFiles}
                // «Меняет» — весь блок (04.10): удаляет тот, кто прикладывает;
                // сервер пускает по тому же праву календаря записи.
                canDelete={!isMemberView || can.editFiles}
                pending={pendingFiles}
                onPendingChange={setPendingFiles}
              />
            ) : null}
          </>
        ),
      })}
    </>
  );
}
