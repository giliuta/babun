import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";

// ДВА РЕЖИМА ОДНОГО СОСТАВИТЕЛЯ — «ПРАВКА» И «ДОКУМЕНТ».
//
// Собственный файл, а не часть `InvoiceEditor.tsx`: переключатель нужен и в
// `InvoiceEditor` (режим «Правка»), и в `InvoicePaperScreen` (режим
// «Документ») — оба они экспортировали бы друг у друга компонент, если бы
// `ModeSwitch` остался внутри одного из них.
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: "edit" | "paper";
  onChange: (next: "edit" | "paper") => void;
}) {
  return (
    <SegmentedControl
      options={[
        { value: "edit", label: "Правка" },
        { value: "paper", label: "Документ" },
      ]}
      value={mode}
      onChange={onChange}
      style={{ marginHorizontal: GUTTER, marginTop: 10, marginBottom: 2 }}
    />
  );
}
