import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
import { CircleDot } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import {
  BOOKING_BLOCKS,
  useBookingBlocks,
  useToggleBookingBlock,
} from "@/features/appointments/booking-prefs";

// «БЛОКИ ФОРМЫ» — своя страница, а не секция в «Записи» (владелец 2026-09-05:
// «включать те блоки, которые нужны — допустим, для бьюти-мастеров объект не
// нужен»).
//
// Отдельной страницей потому, что четыре тумблера рядом с пятью цветными
// строками переполняли экран, а «Запись» обязана читаться сразу целиком.
// Строка везде одна и та же (`ToggleListScreen`): значок, подпись, галка.

export default function BookingBlocksScreen() {
  const t = useThemeColors();
  const enabled = useBookingBlocks();
  const toggle = useToggleBookingBlock();

  return (
    <ToggleListScreen
      title="Блоки формы"
      sections={[
        {
          items: BOOKING_BLOCKS.map((block) => ({
            id: block.id,
            label: block.label,
            icon: CircleDot,
            color: t.accent,
            checked: block.pinned ? true : enabled.includes(block.id),
            // Без команды, времени, клиента и услуг записи нет — эти строки
            // показывают состав страницы, но не выключаются.
            locked: block.pinned,
            lockedNote: block.pinned ? "всегда" : undefined,
            onToggle: () => toggle.mutate(block.id),
          })),
        },
      ]}
    />
  );
}
