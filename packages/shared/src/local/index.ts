// STORY-035 G0 — local namespace placeholder.
//
// The current localStorage-shape model migrates here in G3-G4:
//   * types/   — Client / Master / Brigade / Appointment / …
//   * storage/ — load*/save* functions backed by KVStorage
//   * selectors/ — buildStats, search predicates
//   * mock/    — seed data
//
// G3 will populate the barrel with `export * from "./types/client"` etc.
export {};
