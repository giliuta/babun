// STORY-035 G0 — root barrel for the new @babun/shared/src layout.
//
// Three sibling namespaces live underneath:
//   * common  — pure utilities, enums, icon shim (universal)
//   * local   — current localStorage-shape model + storage-binders
//   * db      — Supabase-shape model (will populate in G5)
//
// `storage/` exposes the cross-cutting KVStorage abstraction.
//
// IMPORTERS should reach for the specific subpath, e.g.
// `import { ... } from "@babun/shared/common/utils/money"`.  The
// root export is intentionally light — it keeps tree-shaking honest.
export {};
