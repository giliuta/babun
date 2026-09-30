import { Camera, FileText, Images, ScanLine } from "lucide-react-native";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { useThemeColors } from "@/theme/colors";
import { scannerAvailable } from "./document-scanner";
import type { useFilePickers } from "./use-file-pickers";

// ЛИСТ «ДОБАВИТЬ» БЛОКА «ФАЙЛЫ» — ОДИН НА ПРОДУКТ. Вынесен из блока файлов
// записи, когда тот же блок встал на страницу клиента (владелец 22.09: «как
// у нас файлы, как везде хранятся файлы»): второй список пунктов разошёлся бы
// с первым в первую же правку — порядок, слова, значки.
//
// Пункты: снять фото или видео, выбрать из галереи, выбрать файл,
// отсканировать документ. Документы требуют владельца-клиента (они лежат во
// вложениях клиента), поэтому без `withDocuments` двух последних нет; скан —
// ещё и только там, где собран нативный сканер.

export function FileAddSheet({
  visible,
  pickers,
  withDocuments,
  onClose,
}: {
  visible: boolean;
  pickers: ReturnType<typeof useFilePickers>;
  withDocuments: boolean;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const menu: PickerSheetItem[] = [
    { id: "camera", label: "Снять фото или видео", icon: Camera, color: t.accent, onPress: () => void pickers.shoot() },
    { id: "library", label: "Выбрать из галереи", icon: Images, color: t.accent, onPress: () => void pickers.pick() },
    ...(withDocuments
      ? [{ id: "file", label: "Выбрать файл", icon: FileText, color: t.accent, onPress: () => void pickers.pickDocument() }]
      : []),
    ...(withDocuments && scannerAvailable()
      ? [{ id: "scan", label: "Отсканировать документ", icon: ScanLine, color: t.accent, onPress: () => void pickers.scanDocument() }]
      : []),
  ];
  return (
    <PickerSheet
      visible={visible}
      title="Добавить"
      items={menu.map((item) => ({
        ...item,
        onPress: () => {
          onClose();
          // Системный пикер поверх уходящего листа не открывается — даём
          // листу уехать.
          setTimeout(item.onPress, 350);
        },
      }))}
      onClose={onClose}
    />
  );
}
