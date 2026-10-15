import { Modal, ScrollView } from "react-native";
import { MirrorBanner } from "@/components/blocks/MirrorBanner";
import { Screen } from "@/components/ui/Screen";
import { clearResumeState } from "./resume";
import { MappingStep } from "./wizard/MappingStep";
import { PreviewStep } from "./wizard/PreviewStep";
import { ResultStep } from "./wizard/ResultStep";
import { UploadStep } from "./wizard/UploadStep";
import { useImportWizard } from "./wizard/use-import-wizard";
import { WizardHeader } from "./wizard/WizardHeader";
import { STEP_SUB } from "./wizard/wizard-rules";

// F1.3 — full CSV import wizard (mobile port of web ImportWizard).
// Upload → Mapping → Preview → Result, rendered as a full-screen modal so
// the list route stays untouched (settings «Импорт из CSV» → openImport
// nonce → this sheet). Reuses ./csv-parse, ./csv-validate, ./useImportRows.
//
// The steps and the wizard state live in `wizard/`.

export function ImportWizardSheet({
  visible,
  onClose,
  teamId = null,
}: {
  visible: boolean;
  onClose: () => void;
  /** Команда, в которую заводятся клиенты (у каждой команды свой импорт,
   *  владелец 30.09); нет — сервер ставит первую доступную. */
  teamId?: string | null;
}) {
  const {
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
  } = useImportWizard({ onClose, teamId });
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // «Назад» Android — то же, что крестик: пока идёт импорт, не закрывает
      // (13.10). Иначе мастер сбрасывался, импорт шёл дальше невидимо, а
      // повторный запуск того же файла плодил дубли — уникального индекса по
      // телефону у базы нет.
      onRequestClose={() => {
        if (!(importer.isPending || preparing)) close();
      }}
    >
      {/* `pageSheet` закрывает почти весь экран вместе с корневой плашкой. */}
      <MirrorBanner inModal />
      <Screen>
        <WizardHeader
          subtitle={STEP_SUB[step]}
          onClose={close}
          busy={importer.isPending || preparing}
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
