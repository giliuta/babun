// ВСЕ БЛОКИ ИНТЕРФЕЙСА BABUN ДЛЯ CLAUDE DESIGN — один список на сборку кода
// (`entry.tsx`, Metro) и на описания свойств (`tsc`, см.
// `.design-sync/build-web.mjs`). Новый блок в `src/components/ui/` попадает в
// дизайн-систему строкой здесь.
export { BabunProvider } from "./BabunProvider";
// Значки — тот же набор lucide, что в приложении, из той же сборки (второй
// экземпляр react-native-svg в дизайне рисовал бы мимо). Строчным именем
// нарочно: конвертер берёт в карточки только имена с заглавной, и полторы
// тысячи значков не должны стать полутора тысячами «блоков».
export * as icons from "lucide-react-native";
export { AddRow } from "@/components/ui/AddRow";
export { AppearanceTile, AppearanceSheet } from "@/components/ui/AppearanceSheet";
export { Badge } from "@/components/ui/Badge";
export { BottomSheet } from "@/components/ui/BottomSheet";
export { Button } from "@/components/ui/Button";
export { Card } from "@/components/ui/Card";
export { Chip } from "@/components/ui/Chip";
export { ChoiceSheetHost } from "@/components/ui/ChoiceSheet";
export { ChooseRow } from "@/components/ui/ChooseRow";
export { ColorPicker } from "@/components/ui/ColorPicker";
export { DateTimeInput } from "@/components/ui/DateTimeInput.web";
export { DateWheelSheet } from "@/components/ui/DateWheelSheet";
export { Divider } from "@/components/ui/Divider";
export { EmptyState } from "@/components/ui/EmptyState";
export { FieldLabel, Field } from "@/components/ui/Field";
export { GradientButton } from "@/components/ui/GradientButton";
export { Halo } from "@/components/ui/Halo";
export { IconCircle } from "@/components/ui/IconCircle";
export { IconPicker } from "@/components/ui/IconPicker";
export { LabelTag } from "@/components/ui/LabelTag";
export { LoadingBar } from "@/components/ui/LoadingBar";
export { MoneyField } from "@/components/ui/MoneyField";
export { NoticeBar } from "@/components/ui/NoticeBar";
export { OptionSheet } from "@/components/ui/OptionSheet";
export { PickerSheet } from "@/components/ui/PickerSheet";
export { RecordMark } from "@/components/ui/RecordMark";
export { ReferenceBlock } from "@/components/ui/ReferenceBlock";
export { ReorderList } from "@/components/ui/ReorderList";
export { ScopeChips } from "@/components/ui/ScopeChips";
export { Screen } from "@/components/ui/Screen";
export { ScreenHeader } from "@/components/ui/ScreenHeader";
export { SectionCard } from "@/components/ui/SectionCard";
export { SectionEyebrow } from "@/components/ui/SectionEyebrow";
export { SegmentedControl } from "@/components/ui/SegmentedControl";
export { SettingsRow } from "@/components/ui/SettingsRow";
export { Spinner } from "@/components/ui/Spinner";
export { SwipeRow } from "@/components/ui/SwipeRow";
export { SwitchControl } from "@/components/ui/SwitchControl.web";
export { SwitchRow } from "@/components/ui/SwitchRow";
export { LoopWheelColumn, TimeWheelPair, TimeRangePicker } from "@/components/ui/TimeWheel";
export { ToastProvider, useToast } from "@/components/ui/Toast";
// Шторка вопроса и выбора — та же, что в приложении: прототип по «Удалить»
// спрашивает так же. Работают внутри BabunProvider (там ChoiceSheetHost).
export { confirmAction } from "@/lib/confirm";
export { chooseOption } from "@/lib/choose";
export { ToggleListScreen } from "@/components/ui/ToggleListScreen";
export { ValueOptionList, ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
export { ValueRow } from "@/components/ui/ValueRow";
export {
  RowGroupHeader,
  RowGroupBody,
  RowGroup,
  FieldRow,
  NavRow,
  RowActionButton,
  ActionRow,
  ChoiceRow,
  ControlRow,
  RowCaption,
} from "@/components/ui/card-rows";
export {
  AppearanceField,
  NameField,
  NameColorField,
} from "@/components/ui/picker-fields";
export { SelectSearch, SelectRow, SelectList } from "@/components/ui/select-rows";
