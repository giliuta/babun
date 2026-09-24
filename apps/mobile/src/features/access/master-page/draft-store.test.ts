import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { draftChangedFrom } from "./master-draft";
import {
  closeMasterDraft,
  openMasterDraft,
  openMasterDraftFromCard,
  readMasterDraft,
  updateMasterDraft,
} from "./draft-store";

describe("черновик нового мастера между карточкой и страницей прав", () => {
  test("права, выставленные на своей странице, видит карточка", () => {
    closeMasterDraft();
    openMasterDraft("team-1");
    updateMasterDraft((draft) => ({
      ...draft,
      calendarLevels: { "team-1": { "calendar.records": "read" } },
    }));
    assert.equal(readMasterDraft()?.draft.calendarLevels["team-1"]?.["calendar.records"], "read");
  });

  test("тот же календарь продолжает набранное, другой начинает заново", () => {
    closeMasterDraft();
    openMasterDraft("team-1");
    updateMasterDraft((draft) => ({ ...draft, name: "Dmitry" }));
    assert.equal(openMasterDraft("team-1").draft.name, "Dmitry");
    assert.equal(openMasterDraft("team-2").draft.name, "");
    assert.deepEqual(readMasterDraft()?.draft.teamIds, ["team-2"]);
  });

  test("после ухода из карточки черновика нет, и правка его не воскрешает", () => {
    closeMasterDraft();
    openMasterDraft("team-1");
    closeMasterDraft();
    assert.equal(readMasterDraft(), null);
    updateMasterDraft((draft) => ({ ...draft, name: "x" }));
    assert.equal(readMasterDraft(), null);
  });

  test("черновик по карточке: чистый на входе, «Новый мастер» его не подхватывает", () => {
    closeMasterDraft();
    const card = openMasterDraftFromCard({
      teamId: "team-1",
      masterId: "master-1",
      name: "Проба",
      phone: "+357 99 123456",
      teamIds: ["team-1"],
    });
    // Карточка открывает тот же черновик — с именем и телефоном карточки.
    const opened = openMasterDraft("team-1", "master-1");
    assert.equal(opened.draft.name, "Проба");
    assert.equal(draftChangedFrom(opened.draft, card.baseline!), false);
    updateMasterDraft((draft) => ({ ...draft, email: "a@b.cy" }));
    assert.equal(draftChangedFrom(readMasterDraft()!.draft, card.baseline!), true);
    // «Новый мастер» того же календаря — пустой и без карточки.
    const fresh = openMasterDraft("team-1");
    assert.equal(fresh.draft.name, "");
    assert.equal(fresh.masterId ?? null, null);
  });
});
