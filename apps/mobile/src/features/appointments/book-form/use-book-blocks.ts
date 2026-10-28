import { useMemo } from "react";
import {
  useAutoColorRule,
  useBookingBlocks,
  useCancelledColor,
  useEventBlocks,
  useFallbackColor,
  usePaidColor,
  usePrepaidColor,
  useSituationPalette,
} from "@/features/appointments/booking-prefs";
import {
  COLOR_SITUATIONS,
  type ColorSituation,
} from "@/features/appointments/record-color";

/** Which blocks this team's record and event show, and how they are coloured. */
export function useBookBlocks(teamId: string | null) {
  // КАКИЕ БЛОКИ НУЖНЫ ЭТОМУ БИЗНЕСУ (Кабинет → «Запись»: например, бьюти-мастерам объект не нужен — его
  // можно убрать).
  const blocks = useBookingBlocks(teamId);
  const showObject = blocks.includes("object");
  const showLabelBlock = blocks.includes("label");
  const showPayment = blocks.includes("payment");
  const showNote = blocks.includes("note");
  const showFiles = blocks.includes("files");
  // БЛОКИ СОБЫТИЯ — СВОИ («Дизайн» → «Блоки события»): у
  // события заметка или объект включаются отдельно от записи.
  const eventBlocks = useEventBlocks(teamId);
  const evShowLabel = eventBlocks.includes("label");
  // Тип у события необязателен: выключен — событие как запись с заметкой.
  const evShowType = eventBlocks.includes("type");
  const evShowClient = eventBlocks.includes("client");
  const evShowObject = eventBlocks.includes("object");
  const evShowNote = eventBlocks.includes("note");
  const evShowFiles = eventBlocks.includes("files");
  // Чем красить запись, когда цвет не выбирали руками, и какими цветами
  // говорить о незаполненном (Кабинет → «Запись»).
  const autoColorRule = useAutoColorRule(teamId);
  const situationPalette = useSituationPalette(teamId);
  const fallbackColor = useFallbackColor(teamId);
  const cancelledColor = useCancelledColor(teamId);
  const paidColor = usePaidColor(teamId);
  const prepaidColor = usePrepaidColor(teamId);
  const activeSituations = useMemo<ColorSituation[]>(
    () =>
      // Подсветка — только у включённых блоков.
      COLOR_SITUATIONS.map((s) => s.id).filter((id) =>
        id === "noObject" ? showObject : showPayment,
      ),
    [showObject, showPayment],
  );
  return {
    blocks,
    showObject,
    showLabelBlock,
    showPayment,
    showNote,
    showFiles,
    eventBlocks,
    evShowLabel,
    evShowType,
    evShowClient,
    evShowObject,
    evShowNote,
    evShowFiles,
    autoColorRule,
    situationPalette,
    fallbackColor,
    activeSituations,
    cancelledColor,
    paidColor,
    prepaidColor,
  };
}
