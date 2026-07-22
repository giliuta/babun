// CSV import — the bulk-insert mutation for the wizard.
//
// Richer sibling of features/clients/queries.ts#useImportClients: that hook
// takes loose drafts + does its own in-cache dedup; this one takes already
// VALIDATED + SELECTED MappedRows (dedup decisions made in the preview step)
// and adds resume-on-interrupt. Both share the same online-only strategy —
// createClientRepo in small parallel chunks — matching the web (which
// batch-inserts straight into supabase, bypassing the offline wrapper).
// A cold import with no network fails and the wizard surfaces the error.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createClient as createClientRepo,
  getClient as getClientRepo,
} from "@babun/shared/db/repositories/clients";
import type { Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { assertQuotaAvailable } from "@/lib/quota";
import { useTenantId } from "@/lib/tenant";
import { tryToE164 } from "../phone";
import type { CountryCode } from "libphonenumber-js";
import type { MappedRow } from "./csv-validate";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearResumeState,
  saveResumeState,
  type ImportResumeState,
} from "./resume";
import { importClientId, rowToClient } from "./import-client";

// Parallel round-trips per chunk. Same 10 the existing importer uses — the
// repo has no array-insert, so «batch» on mobile = a bounded Promise.all.
const CHUNK = 10;

export interface ImportProgress {
  /** Rows actually WRITTEN so far (successful inserts, incl. the resume
   *  baseline). Not «attempted» — a failed row does not advance this, so the
   *  bar and «X / Y клиентов» reflect real progress even on partial errors. */
  done: number;
  total: number;
}

export interface ImportRowError {
  source: number;
  reason: string;
}

export interface ImportRowsResult {
  inserted: number;
  errors: ImportRowError[];
}

export interface ImportRowsArgs {
  /** Rows the preview step decided to keep (already deduped/selected). */
  rows: MappedRow[];
  defaultCountry: CountryCode;
  /** Optional tag applied to every imported client. */
  tagId?: string | null;
  /** File metadata for the resume record. */
  fileHash: string;
  fileName: string;
  /** Resume from this chunk index (inclusive). 0 = full run. */
  startBatchIndex?: number;
  /** Rows already written before this run (for the progress baseline on
   *  resume). 0 on a fresh run. */
  alreadyImported?: number;
  onProgress?: (p: ImportProgress) => void;
}

function isDuplicateImportId(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key[\s\S]*clients_pkey|clients_pkey[\s\S]*duplicate key/i.test(
    message,
  );
}

async function ensureImportTag(
  clientId: string,
  tagId: string | null | undefined,
  tenantId: string,
): Promise<void> {
  if (!tagId) return;
  const { error } = await supabase.from("client_tag_assignments").upsert(
    { client_id: clientId, tag_id: tagId, tenant_id: tenantId },
    { onConflict: "client_id,tag_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Не удалось применить тег: ${error.message}`);
}

async function createImportClient(
  client: Client,
  tagId: string | null | undefined,
  tenantId: string,
): Promise<void> {
  try {
    await createClientRepo(supabase, client, tenantId);
  } catch (error) {
    if (!isDuplicateImportId(error)) throw error;
    const existing = await getClientRepo(supabase, client.id, tenantId);
    if (!existing) throw error;
    await ensureImportTag(client.id, tagId, tenantId);
  }
}

export function useImportRows() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ImportRowsArgs): Promise<ImportRowsResult> => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const {
        rows,
        defaultCountry,
        tagId,
        fileHash,
        fileName,
        startBatchIndex = 0,
        alreadyImported = 0,
        onProgress,
      } = args;

      // Refuse the whole selected batch before the first INSERT when it does
      // not fit the tenant's remaining allowance. Without this preflight a
      // 200-row CSV near the cap produced a misleading partial import: early
      // chunks succeeded and every later row failed independently.
      await assertQuotaAvailable(supabase, tenantId, "clients", rows.length);

      // Slice into fixed chunks so we can persist a resume offset between
      // them. totalBatches is stable across a resume (same rows array).
      const batches: MappedRow[][] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        batches.push(rows.slice(i, i + CHUNK));
      }
      const totalBatches = batches.length;

      const errors: ImportRowError[] = [];
      let inserted = alreadyImported;
      // Whole-file denominator so `done` (which is seeded with the resume
      // baseline) stays proportional on a resumed / retried run — otherwise
      // done could exceed rows.length and the bar would overshoot 100%.
      const progressTotal = alreadyImported + rows.length;

      for (let bi = startBatchIndex; bi < totalBatches; bi++) {
        const batch = batches[bi];
        // Per-row insert so one bad row (RLS / unique-index hit) doesn't sink
        // the whole chunk — settle each and collect the failures.
        const settled = await Promise.allSettled(
          batch.map((r) => {
            const id = importClientId(tenantId, fileHash, r.source);
            return createImportClient(
              rowToClient(r, defaultCountry, tagId, id),
              tagId,
              tenantId,
            );
          }),
        );
        settled.forEach((res, idx) => {
          if (res.status === "fulfilled") inserted++;
          else {
            errors.push({
              source: batch[idx].source,
              reason:
                res.reason instanceof Error
                  ? res.reason.message
                  : String(res.reason),
            });
          }
        });

        // Progress = rows actually written (successful inserts + baseline),
        // NOT chunk attempts — otherwise partial failures make the bar race
        // ahead of reality.
        onProgress?.({
          done: inserted,
          total: progressTotal,
        });

        // Persist resume state after each chunk — a kill after here resumes
        // at bi+1 and never re-inserts this chunk.
        const state: ImportResumeState = {
          fileHash,
          fileName,
          totalRows: rows.length,
          importedRows: inserted,
          totalBatches,
          nextBatchIndex: bi + 1,
          timestamp: Date.now(),
        };
        saveResumeState(state);
      }

      // Completed the run — drop the resume record.
      clearResumeState();
      return { inserted, errors };
    },
    // Refresh the list even on partial failure so the rows that WERE created
    // show up (and a retry sees them as duplicates).
    onSettled: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true }, // the wizard surfaces errors in its result step
  });
}

/** Existing tenant phones as an E.164 set, read from the warm clients cache
 *  (same source the list renders from). Kept as the instant fallback for the
 *  preview display. The import decision itself requires the canonical paged
 *  server read below; a stale cache is not safe enough to prevent duplicates. */
export function existingPhoneSet(clients: Client[]): Set<string> {
  const set = new Set<string>();
  for (const c of clients) {
    const key = c.phone_e164 ?? tryToE164(c.phone ?? "");
    if (key) set.add(key);
  }
  return set;
}

/** Fresh tenant phone set for dedup, read straight from the DB (parity with
 *  the web's fetchExistingPhones — the round-trip IS the correctness
 *  guarantee, since clients.phone_e164 has no unique index and a warm/cold
 *  cache would let already-present or just-inserted rows slip past the
 *  «дубликат в базе» flag and double up). Keys on phone_e164 (the mobile
 *  dedup key), falling back to normalising the raw phone for legacy rows that
 *  never got an E.164 stamped. Paged deterministically to cover every tenant
 *  row. Any error aborts preview: a partial dedup set can create hundreds of
 *  duplicate clients. */
export async function fetchExistingPhoneSet(
  client: SupabaseClient,
  tenantId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("clients")
      .select("id, phone, phone_e164")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Не удалось проверить дубли: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { phone: string | null; phone_e164: string | null }[]) {
      const key = row.phone_e164 ?? tryToE164(row.phone ?? "");
      if (key) set.add(key);
    }
    if (data.length < PAGE_SIZE) break;
  }
  return set;
}
