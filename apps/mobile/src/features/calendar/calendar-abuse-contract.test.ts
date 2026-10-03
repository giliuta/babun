import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЖЁСТКАЯ ПРОВЕРКА КАЛЕНДАРЯ 03.10 — СТОРОЖА ПРАВОК, КОТОРЫЕ НЕ ПОДНЯТЬ БЕЗ
// СИМУЛЯТОРА (экран и жесты тянут react-native). Каждый держит конкретную
// поломку, найденную разбором «как сломать то, что пользователь не делает».

const here = dirname(fileURLToPath(import.meta.url));
const screen = () =>
  readFileSync(resolve(here, "../../../app/(dashboard)/(home)/index.tsx"), "utf8");
const block = () => readFileSync(resolve(here, "AppointmentBlock.tsx"), "utf8");

describe("календарь под нагрузкой", () => {
  test("быстрое событие рождается с uuid — «Отменить» удаляет именно его", () => {
    // Номер — uuid попытки: повтор того же действия после потерянного ответа
    // несёт тот же номер и не заводит второе событие (аудит 03.10).
    const src = screen();
    assert.match(src, /total_amount: 0,\s*\}\), id: attemptId\(attempt\) \};\s*createAppt\.mutate\(ev,/);
    assert.match(src, /const id = randomUuid\(\);\s*attemptIdsRef\.current\.set\(key, id\);/);
  });

  test("копия партнёра несёт номер попытки — повтор не даёт дубля", () => {
    const src = screen();
    assert.match(src, /timeEnd: addMinutesHM\(timeStart, moveWindowMin\),\s*id: attemptId\(attempt\),/);
    assert.match(readFileSync(resolve(here, "mutations.ts"), "utf8"), /p_id: input\.id,/);
  });

  test("двойной тап не открывает форму записи дважды", () => {
    const src = screen();
    assert.match(src, /if \(at - lastBookPushRef\.current < 700\) return;/);
    for (const fn of ["const bookAt = (", "const openEdit = (", "const pickSlotForClient = ("]) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 4000);
      assert.match(body, /pushBookOnce\(\{\s*pathname: "\/book"/, fn);
    }
  });

  test("режимы снимаются: уход с экрана, смена компании, Месяц и Список", () => {
    const src = screen();
    assert.match(src, /setPick\(null\);\s*setMoving\(null\);\s*setEditingApt\(null\);\s*\},\s*\[\],/);
    // Смена компании — именно СМЕНА: на монтировании сброс шёл следом за
    // приёмом параметров и стирал «Записать» из ссылки (повторный аудит).
    assert.match(
      src,
      /if \(clearedForTenantRef\.current === tenantId\) return;\s*clearedForTenantRef\.current = tenantId;\s*setMoving\(null\);\s*setEditingApt\(null\);\s*setPick\(null\);\s*\}, \[tenantId\]\);/,
    );
    assert.match(
      src,
      /if \(m === "month" \|\| m === "agenda"\) \{\s*setEditingApt\(null\);\s*setMoving\(null\);\s*\}/,
    );
  });

  test("«Свободное перемещение» заканчивается тапом и без «Новых записей»", () => {
    assert.equal(
      (screen().match(/onCreateAt=\{canCreateOnGrid \|\| moving \|\| editingApt \? createAtGrid : undefined\}/g) ?? []).length,
      2,
    );
  });

  test("конец 23:59 — конец суток: перенос не сжимает запись на минуту", () => {
    const src = block();
    assert.match(src, /const spanEnd = endMin >= 23 \* 60 \+ 59 \? 24 \* 60 : endMin;/);
    assert.equal((src.match(/const duration = Math\.max\(15, spanEnd - startMin\);/g) ?? []).length, 2);
    assert.doesNotMatch(src, /Math\.max\(endMin, winEnd\)/);
  });

  test("подпись под пальцем ограничена так же, как отпускание", () => {
    assert.match(block(), /clampStart\(startMin \+ steps \* dragStep, Math\.max\(15, spanEnd - startMin\)\)/);
  });
});

describe("повторный аудит календаря 03.10", () => {
  test("личное событие остаётся личным при переносе и копии", () => {
    const src = screen();
    assert.match(src, /const toTeam = isCrew \|\| isPersonalEvent\(apt\) \? apt\.team_id :/);
    assert.match(src, /team_id: isPersonalEvent\(apt\) \? apt\.team_id : \(activeTeamId \?\? apt\.team_id\),/);
  });

  test("отмена визита с деньгами — с вопросом, без «Отменить» и без «Восстановить»", () => {
    const src = screen();
    assert.match(src, /holdsMoney\(apt\)\s*\? void confirmAction\("Отменить визит с оплатой\?"/);
    assert.match(src, /const undoable = to !== "cancelled" \|\| !holdsMoney\(apt\);/);
    assert.match(src, /apt\.status !== "cancelled" \|\| apt\.payment_status !== "refunded";/);
    assert.equal((src.match(/&& restorable\)|if \(restorable\)/g) ?? []).length, 2);
  });

  test("кнопки сотрудника — только по его правам", () => {
    const src = screen();
    assert.match(src, /if \(!event && actionsIn\(apt\.team_id \?\? null\)\.status\) \{/);
    assert.match(src, /ownEvent && eventRightsIn\(apt\.team_id \?\? null\)\.type === "write"/);
    assert.match(src, /\(canManageBookings \|\| activeActions\.schedule === "write"\)\s*\? \(next\) =>/);
    assert.match(src, /const canSlotMenu = canAddBreak && eventsOn;/);
  });

  test("сетку прячет только первая загрузка, а без сети — честное «офлайн»", () => {
    const src = screen();
    const body = src.slice(src.indexOf("const calendarError ="), src.indexOf("const calendarError =") + 700);
    assert.doesNotMatch(body, /Query\.error\b/);
    assert.match(body, /new ColdOfflineCacheMissError\("appointments"\)/);
    assert.match(src, /\(params\.appointmentId && \(appointmentsQuery\.isPending \|\| error\)\)/);
  });

  test("«Личный» не заводится на паузе без сети", () => {
    assert.match(screen(), /if \(teamsPending \|\| teamsFetching \|\| teamsError\) return;/);
  });

  test("оплаченная — только в своём дне: и пальцем, и кубиком", () => {
    const src = screen();
    assert.match(src, /if \(\(dateMoves \|\| teamMoves\) && settledVisit\(apt\)\) \{/);
    assert.match(src, /if \(\(teamChanges \|\| dateYmd !== apt\.date\) && settledVisit\(apt\)\) \{\s*toast\(SETTLED_STAYS, "info"\);\s*return false;/);
  });

  test("один тап по кубику — одна копия", () => {
    const src = screen();
    assert.match(src, /if \(placedFromRef\.current === moving\) return;/);
    assert.match(src, /if \(placed\) placedFromRef\.current = moving;/);
    assert.match(src, /const startMove = \([^)]*\) => \{\s*placedFromRef\.current = null;/);
  });

  test("серия переносится только после вопроса", () => {
    const src = screen();
    assert.equal((src.match(/run: wholeSeries\(\(\) => startMove\(apt\)\)/g) ?? []).length, 2);
    assert.match(src, /confirmAction\("Перенести всю серию\?"/);
  });

  test("режимы и меню не спорят: смена команды у сотрудника, долгое нажатие в правке", () => {
    const src = screen();
    assert.match(src, /if \(isCrew\) setMoving\(null\);\s*\},\s*onSwitchError/);
    assert.equal(
      (src.match(/!canSlotMenu \|\| moving \|\| editingApt \|\| pickClientId \? undefined : slotMenuGrid/g) ?? []).length,
      2,
    );
  });

  test("«своё событие» — глазами того, кого показываем", () => {
    const src = screen();
    assert.match(src, /const actorId = mirror \? mirror\.userId : session\?\.user\.id;/);
    assert.doesNotMatch(src, /created_by === session\?\.user\.id/);
  });

  test("в «Свободном перемещении» сетка не едет — запрет в том же свойстве, что и щипок", () => {
    const zoom = readFileSync(resolve(here, "zoom.tsx"), "utf8");
    assert.match(zoom, /scrollEnabled: !pinching\.value && !lockedSv\.value,/);
    assert.doesNotMatch(zoom, /scrollEnabled=\{!scrollLocked\}/);
  });

  test("перенос пальцем внутри недели не перекручивает сетку", () => {
    assert.match(
      screen(),
      /if \(dateMoves && !\(mode === "week" && weekYmds\.includes\(date\)\)\) \{\s*setDay\(startOfDay\(parseYMD\(date\)\)\);/,
    );
  });

  test("тост, показанный во время угасания прошлого, не стирается", () => {
    const toastSrc = readFileSync(resolve(here, "../../components/ui/Toast.tsx"), "utf8");
    assert.match(toastSrc, /\.start\(\(\{ finished \}\) => \{\s*if \(finished\) setToast\(null\);/);
  });

  test("правки одной записи уходят по очереди жестов, устаревшая — строкой сервера", () => {
    const src = readFileSync(resolve(here, "mutations.ts"), "utf8");
    assert.match(src, /return afterPreviousEdit\(id, \(\) =>\s*updateAppointment\(supabase, id, patch, tenantId as string\),\s*\);/);
    assert.match(src, /const next = previous\.then\(run, run\);/);
    assert.match(src, /err instanceof StaleAppointmentError && err\.fresh \? err\.fresh : ctx\?\.prevRecord/);
  });

  test("«Выходной» ложится поверх свежего графика, а не копии телефона", () => {
    const sched = readFileSync(resolve(here, "../reference/team-schedule.ts"), "utf8");
    assert.match(
      sched,
      /typeof schedule === "function"\s*\? schedule\(\s*pickTeamSchedule\(\s*await listScheduleEntries\(supabase, tenantId as string\),/,
    );
    assert.match(screen(), /schedule: \(current\) => \{\s*const base: TeamSchedule = current \?\?/);
  });

  test("мелочи: «Новая запись» в пустом Списке у сотрудника с одними событиями, удаление записи с возвратом", () => {
    const src = screen();
    assert.match(src, /kind: canManageBookings \|\| activeActions\.create \? "work" : "event",/);
    assert.match(src, /apt\.status === "cancelled" \|\| apt\.payment_status === "refunded"\s*\? "У записи был возврат оплаты/);
  });

  test("полоса тоста смонтирована всегда — второй тост не встаёт невидимым", () => {
    const toastSrc = readFileSync(resolve(here, "../../components/ui/Toast.tsx"), "utf8");
    assert.match(toastSrc, /<Animated\.View\s*pointerEvents=\{toast\?\.action \? "box-none" : "none"\}/);
    assert.doesNotMatch(toastSrc, /\{toast \? \(\s*<Animated\.View/);
  });

  test("вопрос «время прошло» снимается сменой команды, вида и компании", () => {
    assert.match(screen(), /setNotice\(null\);\s*\}, \[activeTeamId, mode, tenantId\]\);/);
  });

  test("«Настроить» метки и шестерёнка — с командой и от двойного тапа", () => {
    const src = screen();
    assert.match(src, /pathname: "\/calendar\/labels",\s*params: activeTeamId \? \{ team: activeTeamId \} : \{\},/);
    assert.match(src, /onGear=\{\(\) => pushBookOnce\(/);
  });

  test("«его глазами» — только то, что отдал бы ему сервер", () => {
    const src = screen();
    assert.match(src, /if \(a\.team_id == null\) return false;\s*const can = actionsIn\(a\.team_id\);\s*if \(can\.records === "hidden"\) return false;\s*return a\.kind === "work" \|\| can\.events !== "hidden";/);
    assert.match(src, /\(eventsOn \|\| a\.kind !== "event"\) &&\s*\(!mirror \|\| mirrorSees\(a\)\),/);
  });

  test("«сегодня» по поясу команды ждёт пояса, а «Сегодня» в Списке — по месяцу", () => {
    const src = screen();
    assert.match(src, /if \(teamsPending \|\| calSettingsQuery\.isPending\) return;\s*if \(todayYmd !== seed\)/);
    assert.match(src, /const isOnToday =\s*mode === "month" \|\| mode === "agenda"/);
  });

  test("окошко дат влезает в экран 320", () => {
    const mini = readFileSync(resolve(here, "MiniCalendar.tsx"), "utf8");
    assert.match(mini, /const CELL = Math\.min\(44, Math\.floor\(\(screenW - 24 - 26 - 2\) \/ 7\)\);/);
  });

  test("часы экрана тикают по смене минуты и при возврате из фона", () => {
    const src = screen();
    assert.match(src, /timer = setTimeout\(tick, 60_000 - \(Date\.now\(\) % 60_000\) \+ 50\);/);
    assert.match(src, /AppState\.addEventListener\("change", \(state\) => \{\s*if \(state === "active"\) tick\(\);/);
    assert.doesNotMatch(src, /setInterval\(\(\) => setNow\(readNow\(\)\), 60000\)/);
  });

  test("«Маршрут →» не раздвигает шапку дня и считает адреса по-русски", () => {
    const agenda = readFileSync(resolve(here, "AgendaView.tsx"), "utf8");
    assert.match(agenda, /minHeight: 44,\s*marginVertical: -13,/);
    assert.match(agenda, /pluralize\(addresses\.length, "адрес", "адреса", "адресов"\)/);
  });

  test("«Финансы дня»: нули тихие, выбранная серая плитка — светлый тинт", () => {
    const sheet = readFileSync(resolve(here, "DayFinanceSheet.tsx"), "utf8");
    for (const k of ["income", "expense", "debt", "planned"]) {
      assert.match(sheet, new RegExp(`quiet=\\{moneySign\\(money\\.${k}\\) === 0\\}`));
    }
    const toggle = readFileSync(resolve(here, "../finances/FinanceOverview.tsx"), "utf8");
    assert.match(toggle, /backgroundColor: active && !locked \? fillRgba\(color, 0\.1\) : t\.surface,/);
  });

  test("«Список» текущего месяца открывается на сегодня, один раз на месяц", () => {
    const agenda = readFileSync(resolve(here, "AgendaView.tsx"), "utf8");
    assert.match(agenda, /const todayIndex = todayYmd\.startsWith\(monthKey\)\s*\? sections\.findIndex\(\(s\) => s\.title >= todayYmd\)/);
    assert.match(agenda, /if \(!monthKey \|\| scrolledFor\.current === monthKey\) return;\s*scrolledFor\.current = monthKey;/);
    assert.match(agenda, /onScrollToIndexFailed=/);
  });

  test("полоса денег под сеткой не выдаёт заглушку прошлой недели за «€0»", () => {
    const footer = readFileSync(resolve(here, "DayFinanceFooter.tsx"), "utf8");
    // Только пока запрос в пути: выключенный запрос (неделя без записей) с
    // заглушкой прошлой недели иначе держал прочерки навсегда. Само правило —
    // `awaitingAnswer` под юнит-тестом в `ledger-select.test.ts`.
    assert.match(footer, /const settling = awaitingAnswer\(ledgerQuery\) \|\| awaitingAnswer\(recordsLedgerQuery\);/);
    assert.match(footer, /\{settling \? "—" : formatEUR\(income\)\}/);
    assert.match(footer, /\{settling \? "—" : formatEUR\(spent\)\}/);
  });

  test("подзаголовки шторок начинаются с заглавной: «Пт, 25 сентября»", () => {
    const src = screen();
    assert.match(src, /subtitle: `\$\{humanDayTitle\(dateYmd\)\}, \$\{timeStart\}`,/);
    assert.match(src, /subtitle: `\$\{humanDayTitle\(apt\.date\)\}, \$\{apt\.time_start\}–\$\{apt\.time_end\}`,/);
    assert.match(src, /reminderFor \? `\$\{humanDayTitle\(reminderFor\.date\)\}/);
    assert.doesNotMatch(src, /subtitle: `\$\{humanDay\(/);
  });

  test("событие без типа показывает своё имя, а не пустую дверь", () => {
    const block = readFileSync(resolve(here, "../appointments/EventTypeBlock.tsx"), "utf8");
    assert.match(block, /: freeTitle\s*\? \{ name: freeTitle, color: titleColor \?\? null, Icon: Tag \}/);
    const book = readFileSync(resolve(here, "../../../app/book/index.tsx"), "utf8");
    assert.match(book, /<EventTypeBlock\s*type=\{eventType\}\s*title=\{eventTitle\}\s*titleColor=\{eventColor\}/);
  });

  test("день и месяц без записей не «грузятся» вечно на заглушке выключенного запроса", () => {
    const sheet = readFileSync(resolve(here, "DayFinanceSheet.tsx"), "utf8");
    assert.match(sheet, /const ledgerLoading = awaitingAnswer\(txQuery\) \|\| awaitingAnswer\(recordsTxQuery\);/);
    assert.doesNotMatch(sheet, /recordsTxQuery\.isPlaceholderData;/);
    const month = readFileSync(resolve(here, "MonthView.tsx"), "utf8");
    assert.match(month, /const ledgerAwaiting = awaitingAnswer\(ledgerQuery\);/);
    // Операции записей не гасят месяц: создание записи не стирает суммы.
    assert.match(month, /ledgerAwaiting\s*\? undefined\s*: \[\.\.\.\(ledgerQuery\.data \?\? \[\]\), \.\.\.\(recordsLedgerQuery\.data \?\? \[\]\)\]/);
    assert.doesNotMatch(month, /recordsLedgerQuery\.isPlaceholderData/);
  });

  test("«Выходной» в шторке метки — по всему графику и снимается с недельного выходного", () => {
    const src = screen();
    assert.match(src, /dayOff=\{cityPickerYmd \? isDayOff\(teamSchedule, cityPickerYmd\) : false\}/);
    assert.match(src, /return setDayOff\(base, ymd, next\);/);
  });

  test("пилюля месяца не горит «Не оплачено» у того, кому оплата скрыта", () => {
    const src = screen();
    const hole = src.slice(src.indexOf("const holeByDay = useMemo("), src.indexOf("const holeFor = useCallback("));
    assert.match(hole, /paymentHidden: paymentHiddenFor\(a\),/);
    assert.match(hole, /todayYmd, paymentHiddenFor\]\);/);
  });

  test("месяц: метка видна и на хвостовых днях; окошко дат не подсвечивает «1» в Месяце", () => {
    const month = readFileSync(resolve(here, "MonthView.tsx"), "utf8");
    assert.match(month, /const label = labelFor\?\.\(key\) \?\? null;/);
    const mini = readFileSync(resolve(here, "MiniCalendar.tsx"), "utf8");
    assert.match(mini, /const isViewed = markOpenDay && !isToday && key === openKey;/);
    assert.match(screen(), /markOpenDay=\{mode === "day" \|\| mode === "week"\}/);
  });

  test("озвучка даты — «3 октября», а не «3 октябрь»", () => {
    for (const f of ["MonthView.tsx", "MiniCalendar.tsx", "WeekView.tsx", "DayView.tsx"]) {
      const src = readFileSync(resolve(here, f), "utf8");
      assert.doesNotMatch(src, /toLocaleDateString\("ru-RU", \{ month: "long" \}\)/, f);
    }
  });
});
