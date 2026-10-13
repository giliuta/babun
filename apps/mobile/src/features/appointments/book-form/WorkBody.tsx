import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { LocalDraftNoteField } from "@/features/appointments/LocalDraftNoteField";
import { PaymentBlock } from "@/features/appointments/PaymentBlock";
import { AppointmentFilesBlock } from "@/features/appointments/AppointmentFilesBlock";
import { withBaselineStatus } from "@/features/appointments/edit-baseline";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { TeamLabelRow } from "@/features/appointments/TeamLabelRow";
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
    pickClientOrRefuse,
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
          этого выезда (владелец 2026-09-04: «можем совместить команду
          и метку в одно, а время поставить блоком ниже»). */}
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
                // тупик посреди расчёта (аудит формы записи 03.10).
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

      {/* ТЕЛО ЗАПИСИ — В ПОРЯДКЕ КОМАНДЫ (владелец 11.10: «поставить первым
          объект, вторым клиент — и самому редактировать»). Команда с
          меткой и время выше — шапка; блоки ниже переставляются в
          «Записях» (`useBookingBlocks` отдаёт их уже по порядку). */}
      {inOrder(blocks, {
        client: (
          <>
            {/* КЛИЕНТ — ПЕРВЫЙ БЛОК И САМ ПО СЕБЕ (владелец 2026-08-31:
                «первый блок это выбор клиента… потом второе это объект»).

                Был один герой «Кому и куда едем»: клиент, адрес, объект и
                маршрут одним списком — «кому и куда» считалось одним
                смыслом. Владелец назвал порядок иначе: клиент → объект →
                услуга → цена, четыре шага, и каждый свой. */}
            {/* ТАП ПО КЛИЕНТУ ОТКРЫВАЕТ ЕГО КАРТОЧКУ (владелец 2026-09-04).
                Раньше строка вела в выбор клиента, и посмотреть, кому едешь
                — телефоны, объекты, историю, долг — из записи было нельзя.

                ПОПРАВКА ТОГО ЖЕ ДНЯ, СЛОВАМИ ВЛАДЕЛЬЦА: «при тапе на
                клиента открывается ВЫБОР нового клиента, а справа от
                телефона значок — три точки, — по нему переход в карточку».
                Так строка везде значит одно: тап по выбранному открывает
                выбор (клиент, объект, услуга). Стрелки справа больше нет ни у
                клиента, ни у объекта.

                03.10 ТРИ ТОЧКИ УБРАНЫ (владелец: «чтобы зайти в карточку
                клиента — зажать на клиента, а если один раз нажать — выбор
                клиента»): карточка — удержанием строки клиента. */}
            {/* БЛОК «КЛИЕНТ» ЖИВЁТ ОТДЕЛЬНО (`features/appointments/ClientBlock.tsx`):
                его же ставит составитель чека. До 2026-09-20 разметка стояла здесь
                ДВАЖДЫ — своя у записи, своя у события, — и копии уже разошлись. */}
            {can.showClient ? (
              <SmsComposeProvider context={recordSmsContext}>
                <ClientBlock
                  client={client}
                  stats={clientStats}
                  onPick={can.editClient ? pickClientOrRefuse : undefined}
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
            {/* ОБЪЕКТ — ВТОРОЙ БЛОК, И ОН СТОИТ ВСЕГДА (владелец: «хочу,
                чтоб был зафиксированный блок, и он никуда не девался и не
                подтягивался»). Раньше объекта не было на экране вовсе,
                пока не выбран клиент, — и человек не знал, что он бывает.

                БЕЗ КЛИЕНТА ОБЪЕКТ НЕ ЗАВОДИТСЯ, и блок говорит об этом
                словом, а не пустотой. Сам владелец пришёл к этому вслух:
                сперва «можно добавить объект без клиента», потом — «объект
                есть, а клиента нет, это очень странно, не та архитектура».
                Верно второе: объект принадлежит клиенту. */}
            <WorkObjectBlock form={form} />
          </>
        ),
        services: (
          <>
            {/* УСЛУГИ. Заголовок был «Услуги и сумма» — владелец
                2026-08-31: «убираем, просто ставим услуги». Сумма и так
                стоит в блоке строкой «Итого»; называть её ещё и в шапке
                значило объявлять два предмета там, где предмет один: набор
                работ, у которого есть цена. */}
            {/* БЛОК «УСЛУГИ» ЖИВЁТ ОТДЕЛЬНО (`features/appointments/ServicesBlock.tsx`):
                его же ставит составитель чека — владелец 2026-09-20 попросил там
                «такой же блок, как в записи», а вторая копия разметки назавтра
                разошлась бы с первой. Вид не менялся ни на пиксель. */}
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
                блок отсутствует, а не стоит без кнопок): партнёр видел «К
                оплате €50» при скрытой оплате (прогон 04.10). */}
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
            {/* Заметка записи — последняя строка формы: «Дополнительно» под ней
                снесено 2026-08-30. Зовётся «заметка записи» (владелец
                2026-09-04): под клиентом и объектом стоят их заметки, и
                третье поле обязано сказать, чьё оно. */}
            {/* Править нельзя и заметки нет — блока нет: пустая шапка
                «Заметка» ничего не говорит (02.10). */}
            {showNote && can.showNote && (can.editNote || comment.trim()) ? (
              // БЛОК, КАК У СОСЕДЕЙ (владелец 2026-09-06: «заметка записи —
              // такой же блок, как под объектом или клиентом, с таким же
              // названием»). Надпись «Заметка» — та же малая шапка.
              <SectionCard title="Заметка">
                {/* ТО ЖЕ ПОЛЕ, ЧТО ЗАМЕТКИ КЛИЕНТА И ОБЪЕКТА (аудит 2026-09-06):
                    три заметки формы были набраны тремя способами — здесь
                    голый ввод 15pt, там плашки 13pt на подложке. Одна
                    заметка — одно поле. Скролл докручивается к полю при
                    фокусе: оно последнее, и KAV оставлял его под клавиатурой
                    (поймано 2026-09-03). */}
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
                  // (владелец 2026-09-10, четвёртый раз за день — после
                  // заметок долга, операции и объекта): «убери „детали,
                  // пожелания, что взять с собой“, вставь просто „заметка
                  // записи“». Инструкция в пустом поле читается как уже
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

      {/* SMS ЗАПИСИ (STORY-089; владелец 25.09: «на записи в самом низу
          блок — что мы уже отправили ему или не отправили»). С 03.10 —
          только история её нынешнему клиенту; отправка — у трубки
          клиента. Блок стоит СРАЗУ, и у новой записи (владелец 03.10:
          «он не появляется после создания записи — он появляется
          сразу»): до первой SMS — «Сообщений пока нет». Партнёру — по
          праву «SMS» записи (03.10). */}
      {can.showSms ? (
        <SmsRecordBlock appointmentId={editing?.id ?? null} clientId={client?.id ?? null} />
      ) : null}

      {/* ОТМЕНЫ И УДАЛЕНИЯ НА СТРАНИЦЕ НЕТ (владелец 2026-09-06: «этот
          блок не нужен — при долгом нажатии на запись снизу поднимется
          мини-меню: удалить, отменить визит, копировать, перенести»).
          Карточка стояла здесь один вечер и снята; действия живут в
          меню долгого нажатия календаря, его состав владелец покажет. */}

      {/* БЛОК «ДОПОЛНИТЕЛЬНО» СНЕСЁН 2026-08-30 (владелец: «убрать
          совсем»). За одной дверью лежали скидка, статус, источник
          заявки и SMS клиенту — пять разных вещей, сложенных вместе
          не по смыслу, а по признаку «редкое».

          Повтор и напоминание переживают снос: у них есть свои двери —
          Кабинет → «Повторяющиеся ТО» и напоминание на карточке
          клиента.

          ПОПРАВКА 2026-08-31: «скидка и источник уходят из продукта»
          было сказано неверно. Источник и SMS-переключатель живы во
          ВТОРОЙ форме записи (`AppointmentSheet`), которой правят
          существующую запись, — снос здесь сделал работу наполовину.
          Скидка же осталась и на этом экране — её вписывают рукой в
          шторке «Итого», а не в этом блоке: он по-прежнему не
          показывает и не меняет скидку. Автоскидку по числу визитов
          сняли 20.09 по слову владельца. */}
    </>
  );
}
