import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// FEATURE BOUNDARIES. Two features never import each other in
// both directions: a cycle makes neither of them understandable or
// changeable on its own. The shared piece moves down — into `src/session/`
// (who is signed in and what they may do), `src/lib/` (helpers),
// `src/components/blocks/` (UI shared by several features) or into the lower
// feature. The neutral layers import nothing from `src/features/`.
//
// Both lists below only shrink: a new pair or a new layer import fails, and
// an entry that no longer applies fails too, so it gets deleted.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Feature pairs that still import each other, with the reason they could not be cut. */
const ALLOWED: Record<string, string> = {
  "appointments<->calendar":
    "calendar/queries.ts (the appointment data layer) is locked by another session; booking reads it while calendar views open the booking sheets",
  "calendar<->clients":
    "calendar/queries.ts is locked; client history reads appointments through it while calendar views read the client list",
  "calendar<->finances":
    "calendar/queries.ts is locked; finance home and analytics read appointments while the calendar day-money views use finance data",
  "appointments<->clients":
    "the record's client/object blocks come from clients while the client card reuses booking helpers, prefs and record rights",
  "appointments<->finances":
    "the record payment block uses finance accounts, receipts and invoices while finance sheets reuse record blocks (BookingSummary, PaymentTiles, WhenSheet)",
  "clients<->finances":
    "the client files tab lists the client's invoices and receipts while finance screens pick and list clients",
};

/** Neutral-layer files that still import a feature, with the reason. */
const LAYER_EXCEPTIONS: Record<string, string> = {
  "components/ui/DateWheelSheet.tsx":
    "uses appointments/helpers date helpers, which import services/economics and cannot move to lib yet",
  "lib/tenant-prefetch.ts":
    "locked by another session; it warms feature query caches (reference, services, calendar, clients)",
};

const NEUTRAL_LAYERS = ["session", "lib", "components"];

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']((?:@\/|\.{1,2}\/)[^"']*)["']/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `features/<name>` for feature code, the top folder (`lib`, `session` …) otherwise. */
function unitOf(file: string): string {
  const parts = path.relative(SRC, file).split(path.sep);
  return parts[0] === "features" ? `features/${parts[1]}` : parts[0];
}

/** Every import of `file` as an absolute path (aliases and relative paths). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(SPECIFIER)].map(([, spec]) =>
    spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(file), spec),
  );
}

type Edges = Map<string, Set<string>>;

function featureEdges(): Edges {
  const edges: Edges = new Map();
  for (const file of sourceFiles(path.join(SRC, "features"))) {
    const from = unitOf(file);
    for (const target of importsOf(file)) {
      const to = unitOf(target);
      if (to === from || !to.startsWith("features/")) continue;
      const a = from.slice("features/".length);
      const b = to.slice("features/".length);
      if (!edges.has(a)) edges.set(a, new Set());
      edges.get(a)!.add(b);
    }
  }
  return edges;
}

/** Pairs of nodes that point at each other, as sorted `a<->b` names. */
function bidirectionalPairs(edges: Edges): string[] {
  const pairs = new Set<string>();
  for (const [a, targets] of edges) {
    for (const b of targets) {
      if (edges.get(b)?.has(a)) pairs.add([a, b].sort().join("<->"));
    }
  }
  return [...pairs].sort();
}

describe("границы фич", () => {
  test("сторож видит цикл", () => {
    const toy: Edges = new Map([
      ["a", new Set(["b", "c"])],
      ["b", new Set(["a"])],
      ["c", new Set<string>()],
    ]);
    assert.deepEqual(bidirectionalPairs(toy), ["a<->b"]);
  });

  test("сторож читает настоящий граф", () => {
    const edges = featureEdges();
    assert.ok(edges.size >= 10, "feature graph looks empty — the walker lost the sources");
    assert.ok(edges.get("calendar")?.has("finances"), "a known edge calendar → finances is missing");
  });

  test("новых пар «фича ↔ фича» нет", () => {
    const pairs = bidirectionalPairs(featureEdges());
    const unexpected = pairs.filter((pair) => !(pair in ALLOWED));
    assert.deepEqual(unexpected, [], "move the shared module down instead of importing both ways");
  });

  test("список разрешённых пар только сжимается", () => {
    const pairs = new Set(bidirectionalPairs(featureEdges()));
    const stale = Object.keys(ALLOWED).filter((pair) => !pairs.has(pair));
    assert.deepEqual(stale, [], "this cycle is gone — delete it from ALLOWED");
  });

  test("session, lib и components не импортируют фичи", () => {
    const found = new Map<string, string[]>();
    for (const layer of NEUTRAL_LAYERS) {
      for (const file of sourceFiles(path.join(SRC, layer))) {
        const hits = importsOf(file)
          .filter((target) => unitOf(target).startsWith("features/"))
          .map((target) => path.relative(SRC, target));
        if (hits.length > 0) found.set(path.relative(SRC, file).split(path.sep).join("/"), hits);
      }
    }
    const unexpected = [...found.keys()].filter((file) => !(file in LAYER_EXCEPTIONS));
    assert.deepEqual(
      unexpected.map((file) => `${file} → ${found.get(file)!.join(", ")}`),
      [],
      "a neutral layer must not import a feature",
    );
    const stale = Object.keys(LAYER_EXCEPTIONS).filter((file) => !found.has(file));
    assert.deepEqual(stale, [], "this file no longer imports a feature — delete it from LAYER_EXCEPTIONS");
  });
});
