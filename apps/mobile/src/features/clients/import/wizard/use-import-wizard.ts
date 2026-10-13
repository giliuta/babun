import { useCallback, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import type { CountryCode } from "libphonenumber-js";
import { useThemeColors } from "@/theme/colors";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useScopeCompany } from "@/features/clients/company-scope";
import { useDefaultCountry } from "../../default-country";
import { useClientTags } from "../../queries";
import { parseCsv, type ParsedCsv } from "../csv-parse";
import { autoMapHeaders, type ImportableField } from "../csv-mapping";
import {
  mapAndValidate,
  selectImportable,
  type MapAndValidateResult,
  type MappedRow,
} from "../csv-validate";
import {
  fetchExistingPhoneSet,
  useImportRows,
  type ImportProgress,
  type ImportRowsResult,
} from "../useImportRows";
import {
  clearResumeState,
  loadResumeState,
  type ImportResumeState,
} from "../resume";
import { fileProblem, rowsProblem, type WizardStep } from "./wizard-rules";

/** State and steps of the CSV import wizard: pick → map → preview → write. */
export function useImportWizard({
  onClose,
  teamId,
}: {
  onClose: () => void;
  teamId: string | null;
}) {
  const t = useThemeColors();
  // Тег импорта — из тегов команды, в которую идёт импорт (30.09).
  const { data: allTags = [] } = useClientTags();
  const tags = useMemo(
    () => (teamId ? allTags.filter((tag) => !tag.team_id || tag.team_id === teamId) : allTags),
    [allTags, teamId],
  );
  // Дубли — из той же компании, куда пишет импорт (компания вкладки, 03.10).
  // Привязанный клиент строится в самой проверке: `useScopeCompany().client`
  // новый на каждый кадр и в зависимостях колбэка не живёт.
  const { tenantId, foreign: scopeForeign } = useScopeCompany();
  const importer = useImportRows();

  const [step, setStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ImportableField[]>([]);
  // КОД СТРАНЫ — ИЗ ЧАСОВОГО ПОЯСА КОМАНДЫ, КУДА ИДЁТ ИМПОРТ (правило 02.10),
  // а не «CY» продукта: у греческой команды номера без кода — греческие.
  // Выбранный руками сильнее.
  const teamCountry = useDefaultCountry(teamId);
  const [countryPick, setCountry] = useState<CountryCode | null>(null);
  const country = countryPick ?? teamCountry;
  const [tagId, setTagId] = useState<string | null>(null);
  const [validation, setValidation] = useState<MapAndValidateResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportRowsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<ImportResumeState | null>(null);
  const [preparing, setPreparing] = useState(false);
  // How many rows were already written by an EARLIER run of this same file
  // (resume across restart). Kept as the result/progress baseline so the
  // final «Импортировано» count reflects the whole file, not just this run.
  const [importedBaseline, setImportedBaseline] = useState(0);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setParsed(null);
    setMapping([]);
    setCountry(null);
    setTagId(null);
    setValidation(null);
    setProgress(null);
    setResult(null);
    setError(null);
    setResume(null);
    setPreparing(false);
    setImportedBaseline(0);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Validate `parsed` against a FRESH tenant phone set (DB round-trip), so the
  // «дубликат в базе» decision never keys on a stale / cold cache — and,
  // critically, so already-inserted rows are seen as duplicates on a
  // resume/retry and are NOT written a second time (no unique index guards
  // clients.phone_e164). If this canonical read fails, block the import:
  // partial/stale dedup data can create hundreds of duplicate clients.
  const runValidate = useCallback(async (): Promise<MapAndValidateResult> => {
    if (!parsed) throw new Error("Нет разобранного файла");
    if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
    const db = scopeForeign ? tenantBoundClient(tenantId) : supabase;
    const existingPhones = await fetchExistingPhoneSet(db, tenantId);
    const v = mapAndValidate({
      rows: parsed.rows,
      headers: parsed.headers,
      mapping,
      defaultCountry: country,
      existingPhones,
    });
    setValidation(v);
    return v;
  }, [parsed, mapping, country, tenantId, scopeForeign]);

  // ── Step 1: pick + parse ────────────────────────────────────────────
  // Guardrails — web parity (UploadStep.tsx): ≤10 МБ, .csv/.txt, непустой
  // файл, ≤5000 строк. Те же RU-тексты ошибок.
  const pick = useCallback(async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "public.comma-separated-values-text",
          "text/plain",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const name = asset.name ?? "файл.csv";
      const badFile = fileProblem(name, asset.size);
      if (badFile) {
        setError(badFile);
        return;
      }
      const text = await (await fetch(asset.uri)).text();
      const p = parseCsv(text);
      const badRows = rowsProblem(p.rows.length);
      if (badRows) {
        setError(badRows);
        return;
      }
      setFileName(name);
      setParsed(p);
      setMapping(autoMapHeaders(p.headers));
      // Resume prompt: only when the stale record is for THIS same file.
      const saved = loadResumeState();
      setResume(saved && saved.fileHash === p.fileHash ? saved : null);
      if (saved && saved.fileHash !== p.fileHash) clearResumeState();
      setStep("mapping");
    } catch (e) {
      setError((e as Error).message || "Не удалось прочитать файл.");
    }
  }, []);

  // ── Step 2 → 3: validate (fresh DB dedup) ───────────────────────────
  const toPreview = useCallback(async () => {
    if (!parsed || preparing) return;
    setError(null);
    setPreparing(true);
    try {
      await runValidate();
      setStep("preview");
    } catch (e) {
      setError((e as Error).message || "Не удалось подготовить предпросмотр.");
    } finally {
      setPreparing(false);
    }
  }, [parsed, preparing, runValidate]);

  // ── Import a given, ALREADY-SELECTED set of rows ────────────────────
  // The single writer. Callers pass the exact `rows` to insert (never
  // recomputed inside), so resume/retry can't silently reshape the batch
  // and drop or duplicate work. Always starts at batch 0 over `rows`; the
  // dedup that keeps already-present rows out of `rows` happens BEFORE the
  // call (fresh-DB selectImportable). `baseline` seeds the progress/result
  // counter with rows an earlier run already wrote for this file.
  const runRows = useCallback(
    async (rows: MappedRow[], baseline: number) => {
      if (!parsed) return;
      setStep("result");
      setProgress(null);
      setResult(null);
      setError(null);
      setImportedBaseline(baseline);
      try {
        const r = await importer.mutateAsync({
          rows,
          defaultCountry: country,
          tagId,
          teamId,
          fileHash: parsed.fileHash,
          fileName,
          startBatchIndex: 0,
          alreadyImported: baseline,
          onProgress: (p) => setProgress(p),
        });
        setResult(r);
      } catch (e) {
        setError((e as Error).message || "Ошибка импорта.");
      }
    },
    [parsed, country, tagId, teamId, fileName, importer],
  );

  // Preview «Импортировать» — insert the currently-selected keep set.
  const runImport = useCallback(() => {
    if (!validation) return;
    const { keep } = selectImportable(validation.mapped);
    void runRows(keep, 0);
  }, [validation, runRows]);

  // Retry after an error that struck BEFORE any result: re-validate against a
  // FRESH DB set, then run the REMAINDER from scratch. Rows THIS run already
  // wrote — now present in the DB — read as «дубликат в базе» and drop out
  // instead of hitting the unique phone index. No offset, no double-write.
  const retryFromError = useCallback(async () => {
    if (!parsed || preparing) return;
    setStep("result");
    setProgress(null);
    setResult(null);
    setError(null);
    setPreparing(true);
    try {
      const v = await runValidate();
      const { keep } = selectImportable(v.mapped);
      // Baseline = rows already written for this file (progress saved it).
      const baseline = resume?.importedRows ?? progress?.done ?? 0;
      await runRows(keep, baseline);
    } catch (e) {
      setError((e as Error).message || "Ошибка импорта.");
    } finally {
      setPreparing(false);
    }
  }, [parsed, preparing, runValidate, resume, progress, runRows]);

  // «Повторить неуд.» after a partial success: re-import ONLY the rows that
  // errored (mapped back by source), never the whole keep — the rows that
  // succeeded are already in the DB and must not be created again.
  const retryFailed = useCallback(() => {
    if (!validation || !result || result.errors.length === 0) return;
    const failedSources = new Set(result.errors.map((e) => e.source));
    const rows = validation.mapped.filter((r) => failedSources.has(r.source));
    // Keep the earlier successes in the running total.
    void runRows(rows, result.inserted);
  }, [validation, result, runRows]);

  const hasName = mapping.some((f) => f === "full_name");
  const selected = validation
    ? selectImportable(validation.mapped)
    : null;

  return {
    t,
    tags,
    importer,
    step,
    setStep,
    parsed,
    mapping,
    setMapping,
    country,
    setCountry,
    tagId,
    setTagId,
    validation,
    progress,
    result,
    error,
    resume,
    setResume,
    preparing,
    importedBaseline,
    close,
    pick,
    toPreview,
    runImport,
    retryFromError,
    retryFailed,
    hasName,
    selected,
  };
}
