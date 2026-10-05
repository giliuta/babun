import { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Paperclip } from "lucide-react-native";

import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import type { PickedAppointmentPhoto } from "@/features/appointments/appointment-photos";
import { FileAddSheet } from "@/features/appointments/FileAddSheet";
import { useFilePickers } from "@/features/appointments/use-file-pickers";
import type { PickedFile } from "@/features/clients/card-attachments";
import { clientFileTimeline } from "@/features/clients/client-files";
import { ClientFileRow } from "@/features/clients/ClientFileRow";
import type { ClientFileItem } from "@/features/clients/use-client-files";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import {
  asAttachment,
  partnerFileUrl,
  useDeletePartnerFile,
  usePartnerFiles,
  useUploadPartnerFiles,
  type PartnerFile,
} from "./partner-files";

// БЛОК «ФАЙЛЫ» НА СТРАНИЦЕ ПАРТНЁРА (владелец 04.10): договор, копия
// документа, сертификаты. Те же плашки, тот же лист «Добавить» и тот же
// свайп «Удалить», что у файлов клиента и записи — свежие сверху. Видео не
// прикладывается: бакет принимает фото, PDF и текст.

const PICK_LIMIT = 5;

export function PartnerFilesBlock({ masterId, canWrite }: { masterId: string; canWrite: boolean }) {
  const t = useThemeColors();
  const toast = useToast();
  const files = usePartnerFiles(masterId);
  const upload = useUploadPartnerFiles(masterId);
  const remove = useDeletePartnerFile(masterId);
  const [menuOpen, setMenuOpen] = useState(false);

  const items = useMemo(() => files.data?.items ?? [], [files.data]);
  const byId = useMemo(() => new Map(items.map((file) => [file.id, file])), [items]);
  const timeline = useMemo(
    () =>
      clientFileTimeline({
        attachments: items.map(asAttachment),
        visitPhotos: [],
        invoices: [],
        receipts: [],
      }) as unknown as ClientFileItem[],
    [items],
  );

  const send = (picked: PickedFile[]) =>
    upload.mutate(picked, {
      onSuccess: (count) => {
        haptics.success();
        toast(count === 1 ? "Файл добавлен" : `Добавлено файлов: ${count}`, "success");
      },
      onError: (error) => toast(error.message, "error"),
    });
  const onMedia = (assets: PickedAppointmentPhoto[]) => {
    const images = assets.filter((asset) => asset.mediaType !== "video");
    if (images.length < assets.length) toast("Видео сюда не прикладывается — только фото и документы", "error");
    if (images.length === 0) return;
    send(images.map((a) => ({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize })));
  };
  const pickers = useFilePickers({ remaining: PICK_LIMIT, busy: upload.isPending, onMedia, onDocs: send });

  const open = async (file: PartnerFile) => {
    try {
      await Linking.openURL(await partnerFileUrl(file));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось открыть файл", "error");
    }
  };
  const askRemove = (file: PartnerFile) =>
    confirmThen("Удалить файл?", { message: file.filename, confirmLabel: "Удалить", destructive: true }, () =>
      remove.mutate(file, {
        onSuccess: () => toast("Файл удалён", "info"),
        onError: (error) => toast(error.message, "error"),
      }),
    );

  // Добавлять нельзя и файлов нет — блока нет: пустая шапка ничего не говорит.
  if (!canWrite && items.length === 0) return null;

  return (
    <>
      <SectionCard title="Файлы">
        {timeline.length > 0 || upload.isPending ? (
          <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 6, gap: 2 }}>
            {upload.isPending ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, minHeight: 44 }}>
                <Spinner size={16} label="Загрузка" />
                <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
                  Загружаем файлы…
                </Text>
              </View>
            ) : null}
            {timeline.map((entry) => {
              const file = byId.get(entry.item.id);
              if (!file) return null;
              const row = (
                <ClientFileRow
                  entry={entry}
                  thumb={files.data?.thumbs[file.id]}
                  onPress={() => {
                    haptics.tap();
                    void open(file);
                  }}
                  onLongPress={canWrite ? () => askRemove(file) : undefined}
                />
              );
              return canWrite ? (
                <SwipeRow
                  key={file.id}
                  radius={t.radius.input}
                  label="Удалить"
                  color={t.danger}
                  onAction={() => askRemove(file)}
                  accessibilityLabel="Удалить файл"
                >
                  {row}
                </SwipeRow>
              ) : (
                <View key={file.id}>{row}</View>
              );
            })}
          </View>
        ) : null}
        {canWrite ? (
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
      <FileAddSheet visible={menuOpen} pickers={pickers} withDocuments onClose={() => setMenuOpen(false)} />
    </>
  );
}
