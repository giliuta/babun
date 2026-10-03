import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Paperclip } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import { clientSubParams } from "@/features/clients/clients-company";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { FileAddSheet } from "@/features/appointments/FileAddSheet";
import { ClientFileRow } from "@/features/clients/ClientFileRow";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { useClientFileUpload, useClientFiles } from "@/features/clients/use-client-files";
import { moreLabel } from "@/features/clients/more-label";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// БЛОК «ФАЙЛЫ» НА КАРТОЧКЕ — КАК «ИСТОРИЯ» (владелец 03.10: «файлы — как
// история, по датам… полноценные блоки, красивые»). В блоке — ПОСЛЕДНИЙ файл
// ленты (фото, документ, инвойс или чек) под заголовком своего дня; тап —
// страница всех файлов (`/clients/attachments`), где каждый файл открывается
// сразу. Квадраты фото и плашки-пилюли, общие с записью, здесь больше не
// стоят: у записи файлов два-три, у клиента — лента за годы.
//
// Файлов нет — блок держит одна дверь «Добавить файл» (как «Добавить объект»).
// «Добавить» кладёт во вложения КЛИЕНТА, а не в запись. Видео к клиенту не
// прикладывается: бакет вложений принимает картинки, PDF и текст.

export default function ClientFilesBlock({
  clientId,
  canChange,
  openOnArrive,
  onArrived,
  showMoney = true,
}: {
  clientId: string;
  /** Добавлять вложения. Без права — только смотреть. */
  canChange: boolean;
  /** Инвойсы и чеки — деньги: без права «Долг и деньги» их в ленте нет. */
  showMoney?: boolean;
  /** Карточку создали из черновика ради файла — сразу открыть лист. */
  openOnArrive?: boolean;
  onArrived?: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const scope = useClientsScopeOrNull();
  const files = useClientFiles(clientId, showMoney);
  const upload = useClientFileUpload(clientId);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!openOnArrive || !canChange) return;
    setMenuOpen(true);
    onArrived?.();
  }, [openOnArrive, canChange, onArrived]);

  const last = files.timeline[0] ?? null;
  const more = moreLabel(files.timeline.length);

  const openAll = () => {
    haptics.tap();
    router.push({ pathname: "/clients/attachments", params: clientSubParams(clientId, scope) });
  };

  // Смотреть нечего и добавить нельзя — блока нет (закон «недоступный блок
  // просто отсутствует»): пустая шапка «Файлы» ни о чём не говорит.
  if (!canChange && !last) return null;

  return (
    <>
      <SectionCard
        title="Файлы"
        // «Ещё N» — файлов сверх показанного последнего (03.10).
        action={more ? { label: more, pill: true, onPress: openAll } : undefined}
      >
        {last ? (
          <>
            <VisitDayHeader date={last.day} />
            <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
              <ClientFileRow
                entry={last}
                thumb={last.type === "photo" ? files.thumbs[last.item.id] : undefined}
                onPress={openAll}
              />
            </View>
          </>
        ) : null}
        {upload.busy ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
            <Spinner size={16} label="Загрузка" />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
              Загружаем файлы…
            </Text>
          </View>
        ) : null}
        {/* Дверь — только у пустого блока: с файлами «Добавить файл» стоит
            внизу страницы всех файлов, как «Добавить объект». */}
        {canChange && !last ? (
          <ChooseRow
            compact
            icon={Paperclip}
            label="Добавить файл"
            onPress={() => {
              haptics.tap();
              setMenuOpen(true);
            }}
          />
        ) : null}
      </SectionCard>

      <FileAddSheet
        visible={menuOpen}
        pickers={upload.pickers}
        withDocuments
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
