// НОВЫЙ МАСТЕР — ЧЕРНОВИК КАРТОЧКИ: сразу полная карточка мастера, как
// создание клиента (имя, почта, телефон; календари и права — до
// «Пригласить»).
//
// Лист без React и без сети: что обязательно, какое положение у блока, какое
// слово стоит у раздела и что уйдёт на сервер вместе с приглашением,
// проверяется тестом, а не глазами.
//
// Public surface; the pieces live in `./master-draft/`.

export {
  STARTER_CALENDAR_LEVELS,
  blankMasterDraft,
  draftLevel,
  emptyMasterDraft,
  starterCalendarChanges,
  type MasterDraft,
  type RightsArea,
} from "./master-draft/draft";
export {
  COLOR_KEY,
  CREATE_KEY,
  DEPENDANT_BLOCKS,
  MOVE_KEY,
  RECORDS_KEY,
  companionLevels,
  dependantResets,
  isBlockFolded,
  isMergedRow,
  parentBlocksOf,
  recordsRowLevel,
} from "./master-draft/dependants";
export {
  applyPickedCalendars,
  draftChangedFrom,
  invitationCarriesCardFields,
  inviteBlockers,
  isDraftDirty,
  toggleTeam,
  withLevel,
  withLiveTeams,
  type InviteBlocker,
} from "./master-draft/edit";
export {
  MIXED_WORD,
  areaLevel,
  areaWord,
  copyCalendarLevels,
  draftAccessChanges,
  foldedBlock,
  levelTone,
  visibleLevel,
  type AreaLevel,
  type LevelTone,
} from "./master-draft/area";
export {
  draftFromInvitation,
  invitationIdFromSegment,
  invitationRequest,
  invitationSegment,
  type MasterInvitationRequest,
} from "./master-draft/invitation";
