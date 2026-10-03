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
    assert.match(screen(), /total_amount: 0,\s*\}\), id: randomUuid\(\) \};\s*createAppt\.mutate\(ev,/);
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

  test("тост, показанный во время угасания прошлого, не стирается", () => {
    const toastSrc = readFileSync(resolve(here, "../../components/ui/Toast.tsx"), "utf8");
    assert.match(toastSrc, /\.start\(\(\{ finished \}\) => \{\s*if \(finished\) setToast\(null\);/);
  });

  test("«Настроить» метки и шестерёнка — с командой и от двойного тапа", () => {
    const src = screen();
    assert.match(src, /pathname: "\/calendar\/labels",\s*params: activeTeamId \? \{ team: activeTeamId \} : \{\},/);
    assert.match(src, /onGear=\{\(\) => pushBookOnce\(/);
  });
});
