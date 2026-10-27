import { InlineNoteField } from "@/components/blocks/InlineNoteField";
import { LocalDraftNoteField } from "@/features/appointments/LocalDraftNoteField";
import { PaymentBlock } from "@/features/appointments/PaymentBlock";
import { AppointmentFilesBlock } from "@/features/appointments/AppointmentFilesBlock";
import { withBaselineStatus } from "@/features/appointments/edit-baseline";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { TeamLabelRow } from "@/components/blocks/TeamLabelRow";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { ServicesBlock } from "@/features/appointments/ServicesBlock";
import { minutesBetweenHM } from "@/features/appointments/helpers";
import { SmsComposeProvider } from "@/features/sms/SmsCompose";
import { SmsRecordBlock } from "@/features/sms/SmsRecordBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import { KEYBOARD_SETTLE_MS } from "./book-constants";
import { inOrder } from "./in-order";
import { WorkObjectBlock } from "./WorkObjectBlock";
import type { BookModel } from "./use-book-form";

/** Body of a client record («Запись»): team and label, time, then the blocks
 *  in the team's order, then the SMS history. */
export function WorkBody({ form }: { form: BookModel }) {
  const {
    t,
    team,
    archivedRecord,
    masterId,
    masters,
    effectiveLabel,
    teamCities,
    city,
    showLabelBlock,
    can,
    moneyHoldsClient,
    toast,
    setTeamSheetOpen,
    setLabelSheetOpen,
    date,
    timeStart,
    timeEnd,
    slotFallback,
    workWarning,
    setWhenOpen,
    blocks,
    recordSmsContext,
    client,
    clientStats,
    pickClientOrOpenCard,
    openClientCard,
    clientNoteOn,
    clientNote,
    clientNoteWritable,
    serviceLines,
    effectiveTotal,
    customTotal,
    discountAmount,
    setServicePickerOpen,
    setTotalSheetOpen,
    showPayment,
    recordRights,
    editing,
    teamId,
    status,
    pendingPayment,
    setPendingPayment,
    clientId,
    setStatus,
    editBaselineRef,
    showNote,
    comment,
    commentNow,
    setComment,
    scrollRef,
    showFiles,
    locationId,
    isMemberView,
    pendingFiles,
    setPendingFiles,
  } = form;
  return (
    <>
      {/* Докет «Команда · Когда» — одна спокойная строка вместо пилюли
          команды и карточки времени с мини-таймлайном */}
      {/* КТО И КУДА — одной карточкой: команда с мастером и метка
          этого выезда (время — блоком ниже). */}
      <TeamLabelRow
        teamName={
          team
            ? archivedRecord
              ? `${team.name} · в архиве`
              : team.name
            : "Команда"
        }
        teamColor={team?.color ?? t.accent}
        masterName={
          masterId
            ? masters.find((m) => m.id === masterId)?.full_name ?? null
            : null
        }
        label={effectiveLabel}
        labelColor={
          teamCities.find((c) => c.name === effectiveLabel)?.color ?? null
        }
        labelFromDay={city == null}
        showLabel={showLabelBlock && can.showLabel}
        onEditTeam={
          can.editTeam
            ? () => {
                // Из архива запись не переносят: она только для просмотра.
                if (archivedRecord) return;
                // КОМАНДУ И ИСПОЛНИТЕЛЯ ДЕРЖАТ ДЕНЬГИ, как клиента
                // (сервер: «клиента, команду и исполнителя менять
                // нельзя»). Лист снимал услуги прежней команды, итог
                // падал в ноль, а сохранение всё равно отвергалось —
                // тупик посреди расчёта.
                if (moneyHoldsClient) {
                  haptics.warning();
                  toast("Команду не сменить: по записи есть оплата. Сначала снимите оплату", "info");
                  return;
                }
                setTeamSheetOpen(true);
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

      {/* КОГДА — своим блоком ниже; предупреждения о времени живут
          здесь же, под ним. */}
      <WhenRow
        date={date}
        timeStart={timeStart}
        timeEnd={timeEnd}
        // ДЛИТЕЛЬНОСТЬ — ПО КОНЦУ ЗАПИСИ, А НЕ ПО СУММЕ УСЛУГ: конец,
        // заданный руками, докет иначе игнорировал.
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

      {/* ТЕЛО ЗАПИСИ — В ПОРЯДКЕ КОМАНДЫ (например, объект первым, клиент вторым —
          человек редактирует сам). Команда с
          меткой и время выше — шапка; блоки ниже переставляются в
          «Записях» (`useBookingBlocks` отдаёт их уже по порядку). */}
      {inOrder(blocks, {
        client: (
          <>
            {/* КЛИЕНТ — ПЕРВЫЙ БЛОК И САМ ПО СЕБЕ: клиент → объект → услуга → цена,
                четыре шага, и каждый свой (не один герой «Кому и куда едем»). */}
            {/* ТАП ПО ВЫБРАННОМУ КЛИЕНТУ ОТКРЫВАЕТ ВЫБОР, А КАРТОЧКА — УДЕРЖАНИЕМ
                строки. Так строка везде значит одно: тап по выбранному открывает
                выбор (клиент, объект, услуга). Стрелки справа нет ни у клиента,
                ни у объекта, и кружка «…» тоже. */}
            {/* БЛОК «КЛИЕНТ» ЖИВЁТ ОТДЕЛЬНО (`features/appointments/ClientBlock.tsx`):
                его же ставит составитель чека. Своя разметка у записи и у события
                разошлась бы. */}
            {can.showClient ? (
              <SmsComposeProvider context={recordSmsContext}>
                <ClientBlock
                  client={client}
                  stats={clientStats}
                  onPick={can.editClient ? pickClientOrOpenCard : undefined}
                  pickOpensCard={moneyHoldsClient}
                  onOpenCard={openClientCard}
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
            {/* ОБЪЕКТ — ВТОРОЙ БЛОК, И ОН СТОИТ ВСЕГДА: зафиксированный блок, который
                никуда не девается и не подтягивается. Если объекта нет на экране,
                пока не выбран клиент, человек не знает, что он бывает.

                БЕЗ КЛИЕНТА ОБЪЕКТ НЕ ЗАВОДИТСЯ, и блок говорит об этом словом, а
                не пустотой: объект принадлежит клиенту. */}
            <WorkObjectBlock form={form} />
          </>
        ),
        services: (
          <>
            {/* УСЛУГИ. Заголовок — просто «Услуги», не «Услуги и сумма»: сумма и так
                стоит в блоке строкой «Итого»; называть её ещё и в шапке значило
                бы объявлять два предмета там, где предмет один: набор работ, у
                которого есть цена. */}
            {/* БЛОК «УСЛУГИ» ЖИВЁТ ОТДЕЛЬНО (`features/appointments/ServicesBlock.tsx`):
                его же ставит составитель чека («такой же блок, как в записи»), а
                вторая копия разметки назавтра разошлась бы с первой. */}
            {can.showServices ? (
              <ServicesBlock
                lines={serviceLines}
                total={effectiveTotal}
                custom={customTotal}
                discountAmount={discountAmount}
                onPickServices={can.editServices ? () => setServicePickerOpen(true) : undefined}
                onOpenTotal={can.editTotal ? () => setTotalSheetOpen(true) : undefined}
                showMoney={can.showMoney}
              />
            ) : null}
          </>
        ),
        payment: (
          <>
            {/* Оплата — сразу после «Итого»: плитки счетов команды, тап
                пишет деньги сразу (STORY-065). Выключается в Кабинет →
                «Запись»: не всякий бизнес принимает деньги в записи. */}
            {/* В архив деньги не принимаются: у архивного календаря счетов в
                живых финансах нет, а блок пишет оплату сразу, мимо «Сохранить». */}
            {/* «Оплата в записи: Скрыта» — блока нет вовсе (недоступный
                блок отсутствует, а не стоит без кнопок): партнёр видел бы «К
                оплате €50» при скрытой оплате. */}
            {showPayment && !archivedRecord && recordRights.payment !== "hidden" ? (
              <PaymentBlock
                appointment={editing}
                teamId={teamId}
                totalDraft={effectiveTotal}
                visit={{ date, timeStart, status }}
                pending={pendingPayment}
                onPendingChange={setPendingPayment}
                clientId={clientId}
                onAppointmentChanged={(fresh) => {
                  // Сервер закрыл визит вместе с оплатой — форма обязана
                  // знать об этом, иначе «Сохранить» вернул бы старый статус,
                  // а «Отмена» спросила бы про несохранённые изменения.
                  setStatus(fresh.status);
                  // Снимок «как в базе» узнаёт тот же статус — и только
                  // его: обнулённый, он снимался заново вместе с
                  // несохранёнными правками (`edit-baseline.ts`).
                  editBaselineRef.current = withBaselineStatus(
                    editBaselineRef.current,
                    fresh.status,
                  );
                }}
              />
            ) : null}
          </>
        ),
        note: (
          <>
            {/* Заметка записи — последняя строка формы. Зовётся «заметка записи»: под
                клиентом и объектом стоят их заметки, и третье поле обязано
                сказать, чьё оно. */}
            {/* Править нельзя и заметки нет — блока нет: пустая шапка
                «Заметка» ничего не говорит. */}
            {showNote && can.showNote && (can.editNote || comment.trim()) ? (
              // БЛОК, КАК У СОСЕДЕЙ: такой же блок, как под объектом или клиентом, с таким же
              // названием. Надпись «Заметка» — та же малая шапка.
              <SectionCard title="Заметка">
                {/* ТО ЖЕ ПОЛЕ, ЧТО ЗАМЕТКИ КЛИЕНТА И ОБЪЕКТА: три заметки формы, набранные
                    тремя способами (голый ввод 15pt, плашки 13pt на подложке),
                    выглядели бы разно. Одна заметка — одно поле. Скролл
                    докручивается к полю при фокусе: оно последнее, и KAV иначе
                    оставлял бы его под клавиатурой. */}
                <LocalDraftNoteField
                  value={comment}
                  onType={(text) => {
                    commentNow.current = text;
                  }}
                  onSettled={setComment}
                  onFocus={() =>
                    setTimeout(
                      () => scrollRef.current?.scrollToEnd({ animated: true }),
                      KEYBOARD_SETTLE_MS,
                    )
                  }
                  // ПОДСКАЗКА НАЗЫВАЕТ ПОЛЕ, А НЕ ОБЪЯСНЯЕТ ПРИМЕРОМ
                  // (подсказка — «Заметка записи»,
                  // как у заметок долга, операции и объекта). Инструкция в пустом поле читается как уже
                  // введённый текст.
                  placeholder="Заметка записи"
                  rows={3}
                  accessibilityLabel="Заметка записи"
                  readOnly={!can.editNote}
                />
              </SectionCard>
            ) : null}
          </>
        ),
        files: (
          <>
            {/* ФАЙЛЫ ЗАПИСИ (STORY-070): фото, документы; у сохранённой
                записи — файлам нужен её id. К отменённой не добавляют. */}
            {showFiles && can.showFiles ? (
              <AppointmentFilesBlock
                appointmentId={editing?.id ?? null}
                clientId={editing?.client_id ?? client?.id ?? null}
                locationId={editing?.location_id ?? locationId ?? null}
                canUpload={status !== "cancelled" && can.editFiles}
                // «Меняет» — весь блок: удаляет тот, кто прикладывает;
                // сервер пускает по тому же праву календаря записи.
                canDelete={!isMemberView || can.editFiles}
                pending={pendingFiles}
                onPendingChange={setPendingFiles}
              />
            ) : null}
          </>
        ),
      })}

      {/* SMS ЗАПИСИ (STORY-089): история сообщений её нынешнему клиенту (что
          отправлено и что нет); отправка — у трубки клиента. Блок стоит
          СРАЗУ, и у новой записи: до первой SMS — «Сообщений пока нет».
          Партнёру — по праву «SMS» записи. */}
      {can.showSms ? (
        <SmsRecordBlock appointmentId={editing?.id ?? null} clientId={client?.id ?? null} />
      ) : null}

      {/* ОТМЕНЫ И УДАЛЕНИЯ НА СТРАНИЦЕ НЕТ: действия живут в меню долгого
          нажатия календаря (удалить, отменить визит, копировать, перенести). */}

      {/* БЛОКА «ДОПОЛНИТЕЛЬНО» НЕТ: скидку вписывают рукой в шторке «Итого»,
          автоскидки по числу визитов нет. Напоминание о клиенте живёт своей
          дверью — на карточке клиента. */}
    </>
  );
}
