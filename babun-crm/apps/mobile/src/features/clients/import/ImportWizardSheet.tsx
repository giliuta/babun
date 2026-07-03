import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Modal } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileUp,
  X,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import type { Client } from "@babun/shared/local/clients";
import { useClients, useClientTags } from "../queries";
import { parseCsv, type ParsedCsv } from "./csv-parse";
import {
  autoMapHeaders,
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  FIELD_LABEL,
  FIELD_OPTIONS,
  type ImportableField,
} from "./csv-mapping";
import {
  mapAndValidate,
  selectImportable,
  type DuplicateAction,
  type MapAndValidateResult,
  type MappedRow,
  type RowReason,
} from "./csv-validate";
import {
  existingPhoneSet,
  fetchExistingPhoneSet,
  useImportRows,
  type ImportProgress,
  type ImportRowsResult,
} from "./useImportRows";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  clearResumeState,
  loadResumeState,
  type ImportResumeState,
} from "./resume";
import type { CountryCode } from "libphonenumber-js";

// F1.3 — full CSV import wizard (mobile port of web ImportWizard).
// Upload → Mapping → Preview → Result, rendered as a full-screen modal so
// the list route stays untouched (settings «Импорт из CSV» → openImport
// nonce → this sheet). Reuses ./csv-parse, ./csv-validate, ./useImportRows.

type WizardStep = "upload" | "mapping" | "preview" | "result";

const STEP_SUB: Record<WizardStep, string> = {
  upload: "Шаг 1 из 4 — выберите файл",
  mapping: "Шаг 2 из 4 — сопоставьте колонки",
  preview: "Шаг 3 из 4 — проверьте перед импортом",
  result: "Шаг 4 из 4 — результат",
};

const REASON_TONE: Record<RowReason, "danger" | "warning"> = {
  "пустое имя": "danger",
  "битый телефон": "danger",
  "дубликат в файле": "warning",
  "дубликат в базе": "warning",
};

export function ImportWizardSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const { data: clients = [] } = useClients();
  const { data: tags = [] } = useClientTags();
  const tenantId = useTenantId();
  const importer = useImportRows();

  const [step, setStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ImportableField[]>([]);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [tagId, setTagId] = useState<string | null>(null);
  const [dupAction, setDupAction] = useState<DuplicateAction>("skip");
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
    setCountry(DEFAULT_COUNTRY);
    setTagId(null);
    setDupAction("skip");
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

  // Instant fallback set for the preview flag; the real dedup runs against a
  // FRESH DB read fetched in toPreview / on resume (see runValidate).
  const existing = useMemo(() => existingPhoneSet(clients as Client[]), [clients]);

  // Validate `parsed` against a FRESH tenant phone set (DB round-trip), so the
  // «дубликат в базе» decision never keys on a stale / cold cache — and,
  // critically, so already-inserted rows are seen as duplicates on a
  // resume/retry and are NOT written a second time (no unique index guards
  // clients.phone_e164). Falls back to the warm cache only if the fetch throws.
  const runValidate = useCallback(async (): Promise<MapAndValidateResult> => {
    if (!parsed) throw new Error("Нет разобранного файла");
    let existingPhones = existing;
    try {
      if (tenantId) existingPhones = await fetchExistingPhoneSet(supabase, tenantId);
    } catch {
      // degrade to the warm-cache set rather than block the import
    }
    const v = mapAndValidate({
      rows: parsed.rows,
      headers: parsed.headers,
      mapping,
      defaultCountry: country,
      existingPhones,
    });
    setValidation(v);
    return v;
  }, [parsed, mapping, country, existing, tenantId]);

  // ── Step 1: pick + parse ────────────────────────────────────────────
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
      const text = await (await fetch(asset.uri)).text();
      const p = parseCsv(text);
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
    [parsed, country, tagId, fileName, importer],
  );

  // Preview «Импортировать» — insert the currently-selected keep set.
  const runImport = useCallback(() => {
    if (!validation) return;
    const { keep } = selectImportable(validation.mapped, dupAction);
    void runRows(keep, 0);
  }, [validation, dupAction, runRows]);

  // Retry after an error that struck BEFORE any result: re-validate against a
  // FRESH DB set, then run the REMAINDER from scratch. Dedup is forced to
  // «skip» here (not the user's dupAction) so rows THIS run already wrote —
  // now present in the DB — read as «дубликат в базе» and drop out instead of
  // double-inserting (clients.phone_e164 has no unique index). The
  // import_as_dup intent was already honoured for pre-existing rows in the
  // first attempt's keep. No offset, no double-write.
  const retryFromError = useCallback(async () => {
    if (!parsed) return;
    setStep("result");
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      const v = await runValidate();
      const { keep } = selectImportable(v.mapped, "skip");
      // Baseline = rows already written for this file (progress saved it).
      const baseline = resume?.importedRows ?? progress?.done ?? 0;
      await runRows(keep, baseline);
    } catch (e) {
      setError((e as Error).message || "Ошибка импорта.");
    }
  }, [parsed, runValidate, resume, progress, runRows]);

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
    ? selectImportable(validation.mapped, dupAction)
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <Screen>
        <WizardHeader
          subtitle={STEP_SUB[step]}
          onClose={close}
          busy={importer.isPending}
        />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {step === "upload" ? (
            <UploadStep t={t} error={error} onPick={pick} />
          ) : null}

          {step === "mapping" && parsed ? (
            <MappingStep
              t={t}
              parsed={parsed}
              mapping={mapping}
              setMapping={setMapping}
              country={country}
              setCountry={setCountry}
              tags={tags}
              tagId={tagId}
              setTagId={setTagId}
              hasName={hasName}
              resume={resume}
              preparing={preparing}
              onResume={() => {
                if (!resume) return;
                // Continue an interrupted import. Rather than trust a saved
                // batch offset against a rebuilt keep (which silently loses
                // the tail when already-inserted rows fall out of keep), we
                // re-validate against a FRESH DB set — the rows written last
                // time now read as «дубликат в базе» and drop out — then run
                // the REMAINDER from scratch (batch 0). No offset, no loss,
                // no double-insert. Same continuation path as an error-retry;
                // the saved importedRows carries into the total via the
                // resume?.importedRows baseline inside retryFromError.
                void retryFromError();
              }}
              onDiscardResume={() => {
                clearResumeState();
                setResume(null);
              }}
              onBack={() => setStep("upload")}
              onNext={() => void toPreview()}
            />
          ) : null}

          {step === "preview" && validation && selected ? (
            <PreviewStep
              t={t}
              validation={validation}
              dupAction={dupAction}
              setDupAction={setDupAction}
              willImport={selected.keep.length}
              willSkip={selected.drop.length}
              onBack={() => setStep("mapping")}
              onConfirm={runImport}
            />
          ) : null}

          {step === "result" ? (
            <ResultStep
              t={t}
              progress={progress}
              result={result}
              error={error}
              baseline={importedBaseline}
              droppedCount={selected?.drop.length ?? 0}
              onRetryError={() => void retryFromError()}
              onRetryFailed={retryFailed}
              onDone={close}
            />
          ) : null}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────
function WizardHeader({
  subtitle,
  onClose,
  busy,
}: {
  subtitle: string;
  onClose: () => void;
  busy: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-2 px-3 py-2"
      style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
    >
      <View className="flex-1">
        <Text className="text-[17px] font-bold" style={{ color: t.ink }}>
          Импорт клиентов
        </Text>
        <Text className="text-xs" style={{ color: t.sub }}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={busy ? undefined : onClose}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Закрыть"
        style={{ height: 36, width: 36, alignItems: "center", justifyContent: "center", opacity: busy ? 0.4 : 1 }}
      >
        <X color={t.body} size={ICON.md} />
      </Pressable>
    </View>
  );
}

// ─── Step 1: Upload ─────────────────────────────────────────────────────
function UploadStep({
  t,
  error,
  onPick,
}: {
  t: ReturnType<typeof useThemeColors>;
  error: string | null;
  onPick: () => void;
}) {
  return (
    <View className="gap-4">
      <Text className="text-sm leading-snug" style={{ color: t.sub }}>
        CSV-файл с заголовком. Распознаются колонки: Имя, Телефон, Город, Email,
        Адрес, Заметка (русские или английские названия, разделитель «,» или
        «;»). Кириллица — в кодировке UTF-8.
      </Text>
      <Pressable
        onPress={onPick}
        accessibilityRole="button"
        accessibilityLabel="Выбрать CSV-файл"
        className="items-center justify-center gap-2 rounded-2xl border border-dashed py-8 active:opacity-60"
        style={{ borderColor: t.separator, backgroundColor: t.surface }}
      >
        <FileUp color={t.accent} size={32} />
        <Text className="text-base font-semibold" style={{ color: t.accent }}>
          Выбрать CSV-файл
        </Text>
        <Text className="text-xs" style={{ color: t.faint }}>
          До 5000 строк за раз
        </Text>
      </Pressable>
      {error ? <ErrorNote t={t} text={error} /> : null}
    </View>
  );
}

// ─── Step 2: Mapping ────────────────────────────────────────────────────
function MappingStep({
  t,
  parsed,
  mapping,
  setMapping,
  country,
  setCountry,
  tags,
  tagId,
  setTagId,
  hasName,
  resume,
  preparing,
  onResume,
  onDiscardResume,
  onBack,
  onNext,
}: {
  t: ReturnType<typeof useThemeColors>;
  parsed: ParsedCsv;
  mapping: ImportableField[];
  setMapping: (m: ImportableField[]) => void;
  country: CountryCode;
  setCountry: (c: CountryCode) => void;
  tags: { id: string; name: string; color: string }[];
  tagId: string | null;
  setTagId: (id: string | null) => void;
  hasName: boolean;
  resume: ImportResumeState | null;
  preparing: boolean;
  onResume: () => void;
  onDiscardResume: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const setCol = (idx: number, field: ImportableField) => {
    const next = [...mapping];
    next[idx] = field;
    // Keep each non-skip field on at most one column (mirror web / auto-map).
    if (field !== "skip") {
      for (let i = 0; i < next.length; i++) {
        if (i !== idx && next[i] === field) next[i] = "skip";
      }
    }
    setMapping(next);
  };

  return (
    <View className="gap-4">
      <Text className="text-xs" style={{ color: t.sub }}>
        {parsed.rows.length} строк · {parsed.headers.length} колонок
      </Text>

      {resume ? (
        <View
          className="gap-2 rounded-2xl p-4"
          style={{ backgroundColor: "rgba(245,166,35,0.10)" }}
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.warning }}>
            Прошлый импорт не завершён
          </Text>
          <Text className="text-[13px] leading-snug" style={{ color: t.warning }}>
            Импортировано {resume.importedRows} из {resume.totalRows}. Продолжить
            с места обрыва — уже добавленные не задвоятся.
          </Text>
          <View className="mt-1 flex-row gap-2">
            <Pressable
              onPress={onResume}
              className="rounded-full px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: t.warning }}
            >
              <Text className="text-[13px] font-semibold text-white">Продолжить</Text>
            </Pressable>
            <Pressable
              onPress={onDiscardResume}
              className="rounded-full px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: t.fill }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: t.body }}>
                Начать заново
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Card className="p-0">
        {parsed.headers.map((h, idx) => (
          <View
            key={idx}
            className="flex-row items-center gap-3 px-4 py-3"
            style={
              idx < parsed.headers.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                : undefined
            }
          >
            <View className="flex-1">
              <Text className="text-[13px]" style={{ color: t.faint }}>
                Колонка {idx + 1}
              </Text>
              <Text
                className="text-[15px]"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {h || `(без названия)`}
              </Text>
            </View>
            <FieldPicker
              t={t}
              value={mapping[idx] ?? "skip"}
              onChange={(f) => setCol(idx, f)}
            />
          </View>
        ))}
      </Card>

      <View className="gap-2">
        <Text
          className="text-[11px] font-bold uppercase"
          style={{ color: t.faint, letterSpacing: 0.6 }}
        >
          Код страны для телефонов без «+»
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {COUNTRY_OPTIONS.map((c) => {
            const active = country === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setCountry(c.value)}
                className="rounded-full px-3 py-1.5 active:opacity-70"
                style={{
                  backgroundColor: active ? t.accent : t.fill,
                }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: active ? "#fff" : t.body }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tags.length > 0 ? (
        <View className="gap-2">
          <Text
            className="text-[11px] font-bold uppercase"
            style={{ color: t.faint, letterSpacing: 0.6 }}
          >
            Тег для всех импортированных
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <TagChip
              t={t}
              label="— нет —"
              active={tagId === null}
              onPress={() => setTagId(null)}
            />
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                t={t}
                label={tag.name}
                color={tag.color}
                active={tagId === tag.id}
                onPress={() => setTagId(tag.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {!hasName ? (
        <ErrorNote
          t={t}
          tone="warning"
          text="Колонка «Имя» обязательна — сопоставьте хотя бы одну (или используйте телефон как имя)."
        />
      ) : null}

      <View className="mt-2 flex-row gap-2">
        <View className="flex-1">
          <Button label="Назад" variant="secondary" onPress={onBack} />
        </View>
        <View className="flex-1">
          <Button
            label={preparing ? "Проверяем…" : "Далее"}
            onPress={onNext}
            disabled={!hasName || preparing}
          />
        </View>
      </View>
    </View>
  );
}

function FieldPicker({
  t,
  value,
  onChange,
}: {
  t: ReturnType<typeof useThemeColors>;
  value: ImportableField;
  onChange: (f: ImportableField) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Поле: ${FIELD_LABEL[value]}`}
        className="flex-row items-center gap-1 rounded-[10px] px-3 py-2 active:opacity-70"
        style={{ backgroundColor: t.fill }}
      >
        <Text
          className="max-w-[120px] text-[13px] font-medium"
          style={{ color: value === "skip" ? t.faint : t.ink }}
          numberOfLines={1}
        >
          {FIELD_LABEL[value]}
        </Text>
        <ChevronDown color={t.faint} size={14} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 items-center justify-center px-8"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setOpen(false)}
        >
          <View
            className="w-full overflow-hidden rounded-2xl"
            style={{ backgroundColor: t.surface }}
          >
            {FIELD_OPTIONS.map((f, i) => {
              const active = f === value;
              return (
                <Pressable
                  key={f}
                  onPress={() => {
                    onChange(f);
                    setOpen(false);
                  }}
                  className="flex-row items-center gap-2 px-4 py-3 active:opacity-70"
                  style={
                    i < FIELD_OPTIONS.length - 1
                      ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                      : undefined
                  }
                >
                  <Text
                    className="flex-1 text-[15px]"
                    style={{ color: t.ink, fontWeight: active ? "700" : "400" }}
                  >
                    {FIELD_LABEL[f]}
                  </Text>
                  {active ? <Check color={t.accent} size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function TagChip({
  t,
  label,
  color,
  active,
  onPress,
}: {
  t: ReturnType<typeof useThemeColors>;
  label: string;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-70"
      style={{ backgroundColor: active ? t.accent : t.fill }}
    >
      {color ? (
        <View
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <Text
        className="text-[13px] font-semibold"
        style={{ color: active ? "#fff" : t.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Step 3: Preview ────────────────────────────────────────────────────
function PreviewStep({
  t,
  validation,
  dupAction,
  setDupAction,
  willImport,
  willSkip,
  onBack,
  onConfirm,
}: {
  t: ReturnType<typeof useThemeColors>;
  validation: MapAndValidateResult;
  dupAction: DuplicateAction;
  setDupAction: (a: DuplicateAction) => void;
  willImport: number;
  willSkip: number;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const sample: MappedRow[] = validation.mapped.slice(0, 10);
  const parts: string[] = [];
  if (validation.emptyName > 0) parts.push(`${validation.emptyName} пустое имя`);
  if (validation.badPhone > 0) parts.push(`${validation.badPhone} битый телефон`);
  if (validation.duplicateInFile > 0)
    parts.push(`${validation.duplicateInFile} дубл. в файле`);
  if (validation.duplicateInDb > 0)
    parts.push(`${validation.duplicateInDb} уже в базе`);

  return (
    <View className="gap-4">
      <Card className="p-4">
        <View className="flex-row gap-3">
          <Counter t={t} value={willImport} label="Готово" tone={t.success} />
          <Counter t={t} value={willSkip} label="Пропущено" tone={t.faint} />
          <Counter
            t={t}
            value={validation.duplicateInDb}
            label="Дубликаты"
            tone={t.warning}
          />
        </View>
        {parts.length > 0 ? (
          <Text className="mt-2 text-xs" style={{ color: t.sub }}>
            {parts.join(" · ")}
          </Text>
        ) : null}
      </Card>

      {validation.duplicateInDb > 0 ? (
        <View className="gap-2">
          <Text
            className="text-[11px] font-bold uppercase"
            style={{ color: t.faint, letterSpacing: 0.6 }}
          >
            Дубликаты по телефону в базе
          </Text>
          <SegmentedControl<DuplicateAction>
            options={[
              { value: "skip", label: "Пропустить" },
              { value: "import_as_dup", label: "Импортировать" },
            ]}
            value={dupAction}
            onChange={setDupAction}
          />
        </View>
      ) : null}

      <Card className="p-0">
        <Text
          className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase"
          style={{ color: t.faint, letterSpacing: 0.6 }}
        >
          Первые 10 строк
        </Text>
        {sample.map((row, i) => (
          <View
            key={row.source}
            className="px-4 py-2.5"
            style={
              i < sample.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                : undefined
            }
          >
            <View className="flex-row items-baseline gap-2">
              <Text className="text-[11px]" style={{ color: t.faint }}>
                #{row.source}
              </Text>
              <Text
                className="flex-1 text-[14px] font-medium"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {row.full_name || "—"}
              </Text>
              {row.phone ? (
                <Text className="text-[12px]" style={{ color: t.sub }}>
                  {row.phone}
                </Text>
              ) : null}
            </View>
            {row.reasons.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-1">
                {row.reasons.map((r) => (
                  <View
                    key={r}
                    className="rounded-[6px] px-1.5 py-0.5"
                    style={{ backgroundColor: t.fill }}
                  >
                    <Text
                      className="text-[11px] font-medium"
                      style={{
                        color: REASON_TONE[r] === "danger" ? t.danger : t.warning,
                      }}
                    >
                      {r}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </Card>

      <View className="mt-2 flex-row gap-2">
        <View className="flex-1">
          <Button label="Назад" variant="secondary" onPress={onBack} />
        </View>
        <View className="flex-1">
          <Button
            label={`Импортировать ${willImport}`}
            onPress={onConfirm}
            disabled={willImport === 0}
          />
        </View>
      </View>
    </View>
  );
}

function Counter({
  t,
  value,
  label,
  tone,
}: {
  t: ReturnType<typeof useThemeColors>;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-2xl font-bold" style={{ color: tone }}>
        {value}
      </Text>
      <Text className="text-xs" style={{ color: t.sub }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Step 4: Result ─────────────────────────────────────────────────────
function ResultStep({
  t,
  progress,
  result,
  error,
  baseline,
  droppedCount,
  onRetryError,
  onRetryFailed,
  onDone,
}: {
  t: ReturnType<typeof useThemeColors>;
  progress: ImportProgress | null;
  result: ImportRowsResult | null;
  error: string | null;
  /** Rows an earlier run of this file already wrote (resume baseline). */
  baseline: number;
  /** Rows intentionally left out by the preview selection (empty name / bad
   *  phone / duplicate). These are «пропущено», distinct from errors. */
  droppedCount: number;
  onRetryError: () => void;
  onRetryFailed: () => void;
  onDone: () => void;
}) {
  // Error before any result — re-validate against the fresh DB and continue
  // the remainder (already-written rows won't double up).
  if (error && !result) {
    return (
      <View className="gap-4">
        <ErrorNote t={t} text={error} />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Закрыть" variant="secondary" onPress={onDone} />
          </View>
          <View className="flex-1">
            <Button label="Повторить" onPress={onRetryError} />
          </View>
        </View>
      </View>
    );
  }

  if (!result) {
    const pct =
      progress && progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : 0;
    return (
      <Card className="gap-3 p-5">
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={t.accent} />
          <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
            Импортируем…
          </Text>
        </View>
        <View
          className="h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: t.fill }}
        >
          <View
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: t.accent }}
          />
        </View>
        <Text className="text-xs" style={{ color: t.faint }}>
          {progress ? `${progress.done} / ${progress.total} клиентов` : "Подготавливаем…"}
        </Text>
      </Card>
    );
  }

  const errorCount = result.errors.length;
  const hasErrors = errorCount > 0;
  // «Импортировано» = rows actually written (incl. any resume baseline —
  // useImportRows seeds `inserted` with it). «Пропущено» = rows the preview
  // intentionally left out (empty name / bad phone / duplicate); errors are a
  // SEPARATE line, never folded into «пропущено».
  void baseline; // already baked into result.inserted
  const skipped = droppedCount;

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <View
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: hasErrors ? t.warning : t.success }}
          >
            {hasErrors ? (
              <AlertTriangle color="#fff" size={17} strokeWidth={2.6} />
            ) : (
              <Check color="#fff" size={18} strokeWidth={3} />
            )}
          </View>
          <Text className="text-[17px] font-bold" style={{ color: t.ink }}>
            {hasErrors ? "Импорт завершён с ошибками" : "Импорт завершён"}
          </Text>
        </View>
        <Text className="text-[14px] leading-snug" style={{ color: t.sub }}>
          Импортировано:{" "}
          <Text className="font-bold" style={{ color: t.ink }}>
            {result.inserted}
          </Text>
          {skipped > 0 ? (
            <Text>
              {" · "}Пропущено:{" "}
              <Text className="font-bold" style={{ color: t.ink }}>
                {skipped}
              </Text>
            </Text>
          ) : null}
          {hasErrors ? (
            <Text>
              {" · "}С ошибкой:{" "}
              <Text className="font-bold" style={{ color: t.warning }}>
                {errorCount}
              </Text>
            </Text>
          ) : null}
        </Text>
        {hasErrors ? (
          <View className="flex-row items-start gap-2">
            <AlertTriangle color={t.warning} size={16} strokeWidth={2.2} />
            <Text className="flex-1 text-[13px] leading-snug" style={{ color: t.warning }}>
              {errorCount} {countRowsRu(errorCount)} не {errorCount === 1 ? "прошла" : "прошли"} (первая: #{result.errors[0].source} —{" "}
              {result.errors[0].reason}).
            </Text>
          </View>
        ) : null}
      </Card>

      <View className="flex-row gap-2">
        {hasErrors ? (
          <View className="flex-1">
            <Button label="Повторить неуд." variant="secondary" onPress={onRetryFailed} />
          </View>
        ) : null}
        <View className="flex-1">
          <Button label="Готово" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

/** «строка / строки / строк» for the error line. */
function countRowsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "строка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "строки";
  return "строк";
}

// ─── Shared bits ────────────────────────────────────────────────────────
function ErrorNote({
  t,
  text,
  tone = "danger",
}: {
  t: ReturnType<typeof useThemeColors>;
  text: string;
  tone?: "danger" | "warning";
}) {
  const color = tone === "danger" ? t.danger : t.warning;
  const bg = tone === "danger" ? "rgba(240,71,60,0.10)" : "rgba(245,166,35,0.10)";
  return (
    <View
      className="flex-row items-start gap-2 rounded-[10px] px-3 py-2.5"
      style={{ backgroundColor: bg }}
    >
      <AlertTriangle color={color} size={16} strokeWidth={2.2} />
      <Text className="flex-1 text-[13px] leading-snug" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}
