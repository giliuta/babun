import { useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Image as ImageIcon, Paperclip, X } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { RowCaption } from "@/components/ui/card-rows";
import {
  formatBytes,
  getSignedUrl,
  isImage,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
} from "@/features/clients/card-attachments";
import { useClient } from "@/features/clients/queries";
import { useClientAppointments } from "@/features/clients/appointments";
import {
  KIND_LABEL,
  useClientVisitPhotos,
  type VisitPhoto,
} from "@/features/clients/visit-photos";
import { formatShortDateRu } from "@/features/clients/format";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

// ДОКУМЕНТАЦИЯ КЛИЕНТА — ПОЛНОЦЕННАЯ СТРАНИЦА (владелец 2026-08-03: «вложения
// надо исправлять — полноценно открывается страница, где вся документация о
// клиенте: все документы, все чеки, все инвойсы, все фотографии»).
//
// На карточке от блока осталась ОДНА строка «Документация» в блоке заметок:
// действия («+ Фото или файл», «+ Снять фото») занимали место постоянно, а
// самих файлов при этом не показывали — сетка миниатюр ютилась под ними.
//
// Здесь всё наоборот: файлы — главное, добавление — одна кнопка «+» в
// заголовке (лист «Добавить»: галерея · камера · документ). Фото идут сеткой
// (их узнают глазами), документы — списком с размером и датой (их узнают по
// имени).

const COLUMNS = 3;

function dateRu(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function ClientAttachmentsScreen() {
  const t = useThemeColors();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client } = useClient(id);
  // Откуда файл: «из записи 12 мар». Запись могла быть удалена — тогда
  // appointment_id уже NULL (ON DELETE SET NULL), и подписи просто нет.
  const { data: appointments = [] } = useClientAppointments(id);
  // ФОТО С ВЫЕЗДОВ приезжают сюда САМИ: они сняты в записях и лежат в своей
  // таблице — страница вложений просто показывает их вместе с документами
  // клиента (владелец 2026-08-03: «всё, что проведено в записях, автоматически
  // отправляется во вложения»).
  const { data: visitPhotos = [] } = useClientVisitPhotos(
    id,
    appointments.map((a) => a.id),
  );
  const { data, isLoading, isError, refetch } = useClientAttachments(id);
  const upload = useUploadAttachments(id);
  const remove = useDeleteAttachment(id);
  const [opening, setOpening] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const items = data?.items ?? [];
  const thumbs = data?.thumbs ?? {};
  const photos = items.filter((a) => isImage(a));
  const docs = items.filter((a) => !isImage(a));
  const aptDate = new Map(appointments.map((a) => [a.id, a.date]));
  /** «из записи 12 мар» — происхождение файла, если он пришёл с выезда. */
  const originOf = (appointmentId: string | null): string | null => {
    if (!appointmentId) return null;
    const date = aptDate.get(appointmentId);
    return date ? `из записи ${formatShortDateRu(date)}` : "из записи";
  };

  const uploadAssets = (assets: ImagePicker.ImagePickerAsset[]) =>
    upload.mutate(
      assets.map((a) => ({
        uri: a.uri,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
      })),
    );

  const showSelectionError = (error: unknown) =>
    notify(
      "Не удалось выбрать файл",
      error instanceof Error ? error.message : "Попробуйте ещё раз.",
    );

  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.8,
        // Просим iOS перекодировать HEIC: иначе файл отклоняется уже ПОСЛЕ
        // того, как человек его выбрал.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled || res.assets.length === 0) return;
      uploadAssets(res.assets);
    } catch (error) {
      showSelectionError(error);
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/plain",
          "image/jpeg",
          "image/png",
          "image/webp",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || res.assets.length === 0) return;
      upload.mutate(
        res.assets.slice(0, 5).map((asset) => ({
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType ?? undefined,
          fileSize: asset.size,
        })),
      );
    } catch (error) {
      showSelectionError(error);
    }
  };

  // Снять «до/после» прямо на объекте — ключевой полевой сценарий.
  const shoot = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        notify(
          "Нет доступа к камере",
          "Разрешите камеру: Настройки → Babun → Камера.",
        );
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (res.canceled || res.assets.length === 0) return;
      uploadAssets(res.assets);
    } catch (error) {
      showSelectionError(error);
    }
  };

  const confirmDelete = (a: ClientAttachment) =>
    confirmThen(
      "Удалить файл?",
      {
        message: a.filename,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () => remove.mutate(a),
    );

  const open = async (a: ClientAttachment) => {
    setOpening(a.id);
    try {
      const url = await getSignedUrl(a);
      await Linking.openURL(url);
    } catch {
      notify("Не удалось открыть файл");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Документация"
        subtitle={client?.full_name || undefined}
        right={
          <Pressable
            onPress={() => {
              haptics.tap();
              setAddOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Добавить вложение"
            hitSlop={8}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 12,
              opacity: pressed || upload.isPending ? 0.5 : 1,
            })}
          >
            {/* СЛОВОМ, а не родовым «плюсом» (закон продукта: добавление
                называется, а не рисуется значком). */}
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 16, fontWeight: "600", color: t.accent }}
            >
              Добавить
            </Text>
          </Pressable>
        }
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          state="error"
          fill
          subtitle="Не удалось загрузить файлы."
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : items.length === 0 && visitPhotos.length === 0 ? (
        <EmptyState
          fill
          title="Пока пусто"
          subtitle="Договоры, счета и чеки — здесь. Фото «до/после» с выездов попадают сюда сами, как только команда снимет их в записи."
          action={{ label: "Добавить файл", onPress: () => setAddOpen(true) }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {upload.isPending ? (
            <View className="flex-row items-center gap-2 px-4 pt-3">
              <Spinner size={16} label="Загрузка" />
              <Text style={{ fontSize: 13, color: t.sub }}>Загружаем файлы…</Text>
            </View>
          ) : null}

          {photos.length > 0 ? (
            <>
              <SectionEyebrow>Фотографии</SectionEyebrow>
              <SectionCard padded>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {photos.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => void open(a)}
                      onLongPress={() => confirmDelete(a)}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={a.filename}
                      accessibilityHint="Открыть; удерживайте, чтобы удалить"
                      style={({ pressed }) => ({
                        width: `${100 / COLUMNS}%`,
                        aspectRatio: 1,
                        opacity: pressed || opening === a.id ? 0.6 : 1,
                      })}
                    >
                      <View
                        style={{
                          flex: 1,
                          margin: 2,
                          borderRadius: t.radius.input,
                          overflow: "hidden",
                          backgroundColor: t.fill,
                        }}
                      >
                        {thumbs[a.id] ? (
                          <Image
                            source={{ uri: thumbs[a.id] }}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="flex-1 items-center justify-center">
                            <ImageIcon color={t.faint} size={18} strokeWidth={2} />
                          </View>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </SectionCard>
              <RowCaption
                text={
                  photos.some((a) => a.appointment_id)
                    ? `Тап — открыть, удержание — удалить. С выездов: ${photos.filter((a) => a.appointment_id).length}.`
                    : "Тап — открыть, удержание — удалить."
                }
              />
            </>
          ) : null}

          {visitPhotos.length > 0 ? (
            <>
              <SectionEyebrow>С выездов</SectionEyebrow>
              <SectionCard padded>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {visitPhotos.map((p: VisitPhoto) => (
                    <Pressable
                      key={p.id}
                      onPress={() => void Linking.openURL(p.url)}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`${KIND_LABEL[p.kind]}, ${originOf(p.appointment_id) ?? "запись"}`}
                      style={({ pressed }) => ({
                        width: `${100 / COLUMNS}%`,
                        aspectRatio: 1,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View
                        style={{
                          flex: 1,
                          margin: 2,
                          borderRadius: t.radius.input,
                          overflow: "hidden",
                          backgroundColor: t.fill,
                        }}
                      >
                        <Image
                          source={{ uri: p.url }}
                          style={{ width: "100%", height: "100%" }}
                          resizeMode="cover"
                        />
                      </View>
                    </Pressable>
                  ))}
                </View>
              </SectionCard>
              {/* Удалять фото визита отсюда нельзя: оно принадлежит записи,
                  и убирать его надо там же, где сняли — иначе команда не
                  поймёт, куда делось «до/после». */}
              <RowCaption text="Сняты командой в записях. Удалить можно в самой записи." />
            </>
          ) : null}

          {docs.length > 0 ? (
            <>
              <SectionEyebrow>Документы</SectionEyebrow>
              <SectionCard>
                {docs.map((a, i) => (
                  <Pressable
                    key={a.id}
                    onPress={() => void open(a)}
                    accessibilityRole="button"
                    accessibilityLabel={a.filename}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      minHeight: 56,
                      paddingHorizontal: 16,
                      borderTopWidth: i > 0 ? 1 : 0,
                      borderTopColor: t.separator,
                      backgroundColor: pressed ? t.pressed : "transparent",
                    })}
                  >
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: `${t.accent}1a`,
                      }}
                    >
                      <FileText color={t.accent} size={16} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                      >
                        {a.filename}
                      </Text>
                      <Text style={{ fontSize: 12, color: t.faint }}>
                        {[
                          formatBytes(a.size_bytes),
                          dateRu(a.created_at),
                          originOf(a.appointment_id),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    {opening === a.id ? (
                      <Spinner size={16} label="Открываем" />
                    ) : (
                      <Pressable
                        onPress={() => confirmDelete(a)}
                        accessibilityRole="button"
                        accessibilityLabel={`Удалить ${a.filename}`}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                      >
                        <X color={t.faint} size={16} strokeWidth={2.2} />
                      </Pressable>
                    )}
                  </Pressable>
                ))}
              </SectionCard>
            </>
          ) : null}
        </ScrollView>
      )}

      <PickerSheet
        visible={addOpen}
        title="Добавить вложение"
        onClose={() => setAddOpen(false)}
        items={[
          {
            id: "photo",
            label: "Фото из галереи",
            icon: ImageIcon,
            color: t.accent,
            onPress: () => void pickPhoto(),
          },
          {
            id: "camera",
            label: "Снять фото",
            icon: Camera,
            color: "#1F7A44",
            onPress: () => void shoot(),
          },
          {
            id: "file",
            label: "Файл или документ",
            icon: Paperclip,
            color: "#5b6678",
            onPress: () => void pickDocument(),
          },
        ]}
      />
    </Screen>
  );
}
