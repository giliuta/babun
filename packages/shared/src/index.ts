// Package entry for @babun/shared. Intentionally empty — it exists only to
// give `main`/`types` a target, because nothing imports the package root.
//
// Consumers reach for the subpath that owns the code, e.g.
// `@babun/shared/common/utils/money`, `@babun/shared/local/clients`,
// `@babun/shared/db/repositories/clients`. Re-exporting those here would
// pull every namespace into one module graph: a screen that wants one
// money helper would drag the whole Supabase layer in with it.
//
// Namespaces: common (pure utils), local (UI-shape model + storage binders),
// db (Supabase-shape model and repositories), storage (KVStorage seam),
// sync (offline queue, realtime, cached readers).
export {};
