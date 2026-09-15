import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  closeMasterDraft,
  openMasterDraft,
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
});
