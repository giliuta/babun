import { Text, View, useWindowDimensions } from "react-native";
import { FileText, Image as ImageIcon, Receipt, ReceiptText, Video } from "lucide-react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import { SelectRow } from "@/components/ui/select-rows";
import { docTitle, isVideoPath } from "@/features/appointments/appointment-files";
import { formatBytes } from "@/features/clients/card-attachments";
import { fileTime } from "@/features/clients/client-files";
import type { ClientFileItem } from "@/features/clients/use-client-files";
import { KIND_LABEL } from "@/features/clients/visit-photos";
import { useThemeColors } from "@/theme/colors";

// ФАЙЛ КЛИЕНТА — ОТДЕЛЬНОЙ ПЛАШКОЙ, КАК ЗАПИСЬ В «ИСТОРИИ» (владелец 03.10:
// «файлы — как история, по датам… полноценные блоки, красивые, чтобы сразу
// открывать»). Это наш `SelectRow` на белом, как `VisitRow`:
//   · фото — плиткой с самим снимком (фото узнают глазами);
//   · документ — значком файла, имя — названием, подпись — время и размер;
//   · инвойс и чек — значком документа, номер — названием;
//   · справа у инвойса и чека — только сумма своим цветом, в столбике той же
//     ширины, что у «Истории»: получено — зелёным, ждёт оплаты — янтарём.
// Дату называет заголовок дня над плашками — в строке её нет.

/** Столбик суммы — тот же, что у записи в «Истории» (`VisitRow`). */
const AMOUNT_COLUMN = 64;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function ClientFileRow({
  entry,
  thumb,
  inRecord = false,
  onPress,
  onLongPress,
}: {
  entry: ClientFileItem;
  /** Миниатюра вложения-снимка (подписанная ссылка); у фото с выезда своя. */
  thumb?: string;
  /** В самой записи снимок — просто «Фото» или «Видео»: «с выезда» там и так
   *  ясно (блок «Файлы» записи, 03.10). */
  inRecord?: boolean;
  onPress: () => void;
  /** Удержание — меню своего файла («Удалить»). */
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const time = fileTime(entry.at);

  let title = "";
  let subtitle = "";
  let icon = FileText;
  let color = t.accent;
  let image: string | undefined;
  let amount: { text: string; color: string } | null = null;

  switch (entry.type) {
    case "photo":
      title = "Фото";
      subtitle = [time, entry.item.appointment_id ? "из записи" : ""].filter(Boolean).join(" · ");
      icon = ImageIcon;
      image = thumb || undefined;
      break;
    case "visit": {
      // «До работы», «После работы»; просто снимок с выезда — «Фото с выезда»
      // (в самой записи — «Фото» или «Видео»). У видео снимка нет — значок:
      // ссылка на ролик в плитке картинкой не рисуется, плитка была пустой.
      const video = isVideoPath(entry.item.storage_path);
      title =
        entry.item.kind !== "other"
          ? capitalize(KIND_LABEL[entry.item.kind])
          : video
            ? "Видео"
            : inRecord
              ? "Фото"
              : "Фото с выезда";
      subtitle = time;
      icon = video ? Video : ImageIcon;
      image = video ? undefined : entry.item.url || undefined;
      break;
    }
    case "file":
      title = docTitle(entry.item.filename);
      subtitle = [time, formatBytes(entry.item.size_bytes)].filter(Boolean).join(" · ");
      break;
    case "invoice":
      title = `Инвойс ${entry.item.number}`;
      subtitle = time;
      icon = Receipt;
      amount = {
        text: formatEUR(entry.item.total),
        color: entry.item.status === "paid" ? t.success : t.warning,
      };
      break;
    case "receipt":
      title = `Чек ${entry.item.number}`;
      subtitle = time;
      icon = ReceiptText;
      color = t.success;
      amount = { text: formatEUR(entry.item.amount), color: t.success };
      break;
  }

  return (
    <SelectRow
      icon={icon}
      color={color}
      image={image}
      plain
      title={title}
      subtitle={subtitle || undefined}
      accessibilityLabel={[title, subtitle, amount?.text].filter(Boolean).join(", ")}
      accessibilityHint="Открывает файл"
      onPress={onPress}
      onLongPress={onLongPress}
      trailing={
        amount ? (
          <View style={{ minWidth: Math.round(AMOUNT_COLUMN * Math.min(fontScale, 1.3)), alignItems: "flex-end" }}>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "700", color: amount.color, fontVariant: ["tabular-nums"] }}
            >
              {amount.text}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}
