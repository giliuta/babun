import type { Json } from "./database.types";

/**
 * Domain value → jsonb column (or a parser that takes `Json`).
 *
 * Domain types stored in jsonb (services, payments, phones, locations …) are
 * plain JSON data, but TypeScript cannot prove that an interface fits the
 * recursive `Json` type, so every such write needed a double cast. This is
 * that cast, in one place, with this reason next to it.
 */
export function toJson<T>(value: T): Json {
  return value as unknown as Json;
}
