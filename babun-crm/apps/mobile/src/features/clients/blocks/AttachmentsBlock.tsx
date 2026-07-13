// AttachmentsBlock — photos & files on the client card (mobile port of
// apps/web/src/components/clients/blocks/AttachmentsBlock.tsx, F3.10).
//
// Reference block — collapsed by default (CollapsibleCard); the closed row
// shows the file count. Expanded: 3-column grid of thumbnails (images via
// 5-min signed URLs) / doc tiles, «Добавить фото» (галерея) + камера —
// оба через expo-image-picker, long-press-free delete via an ✕ badge with
// Alert confirm, tap opens the original through Linking.
//
// Data path lives in card-attachments.ts (Supabase Storage bucket
// client-attachments + public.client_attachments), the block itself only
// renders states: loading / error+retry / empty / grid.

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Paperclip, Plus, X } from "lucide-react-native";
import {
  formatBytes,
  getSignedUrl,
  isImage,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
} from "@/features/clients/card-attachments";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { useThemeColors } from "@/theme/colors";

interface AttachmentsBlockProps {
  clientId: string;
}

export default function AttachmentsBlock({ clientId }: AttachmentsBlockProps) {
  const t = useThemeColors();
  const { data, isLoading, isError, refetch } = useClientAttachments(clientId);
  const upload = useUploadAttachments(clientId);
  const remove = useDeleteAttachment(clientId);
  const [opening, setOpening] = useState<string | null>(null);

  const items = data?.items ?? [];
  const thumbs = data?.thumbs ?? {};

  const uploadAssets = (assets: ImagePicker.ImagePickerAsset[]) =>
    upload.mutate(
      assets.map((a) => ({
        uri: a.uri,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
      })),
    );

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.8,
    });
    if (res.canceled || res.assets.length === 0) return;
    uploadAssets(res.assets);
  };

  // Снять «до/после» прямо на объекте — ключевой полевой сценарий.
  // NSCameraUsageDescription уже в dev-билде (плагин expo-image-picker),
  // пересборка не нужна.
  const shoot = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
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
  };

  const confirmDelete = (a: ClientAttachment) => {
    Alert.alert("Удалить файл?", a.filename, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => remove.mutate(a),
      },
    ]);
  };

  const open = async (a: ClientAttachment) => {
    setOpening(a.id);
    try {
      const url = await getSignedUrl(a);
      await Linking.openURL(url);
    } catch {
      Alert.alert("Не удалось открыть файл");
    } finally {
      setOpening(null);
    }
  };

  return (
    <CollapsibleCard
      title="Вложения"
      summary={items.length ? String(items.length) : ""}
    >
      <View className="gap-2 px-1 pt-1">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={pick}
            disabled={upload.isPending}
            accessibilityRole="button"
            accessibilityLabel="Добавить фото"
            className="flex-row items-center gap-1.5 rounded-[10px] px-3 py-2 active:opacity-80"
            style={{ backgroundColor: upload.isPending ? t.disabledFill : t.accent }}
          >
            <Plus color={upload.isPending ? t.faint : "#fff"} size={14} strokeWidth={2.5} />
            <Text
              className="text-[13px] font-semibold"
              style={{ color: upload.isPending ? t.faint : "#fff" }}
            >
              {upload.isPending ? "Загрузка…" : "Добавить фото"}
            </Text>
          </Pressable>
          <Pressable
            onPress={shoot}
            disabled={upload.isPending}
            accessibilityRole="button"
            accessibilityLabel="Снять фото"
            className="h-[33px] w-[33px] items-center justify-center rounded-[10px] active:opacity-70"
            style={{ backgroundColor: t.fill }}
          >
            <Camera color={upload.isPending ? t.faint : t.ink} size={16} strokeWidth={2.2} />
          </Pressable>
          <Text className="flex-1 text-[11px]" style={{ color: t.faint }}>
            До 10 МБ. Фото «до/после», договоры.
          </Text>
        </View>

        {isLoading ? (
          <View className="items-center py-3">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <View className="flex-row items-center gap-2 py-1">
            <Text className="flex-1 text-[12px]" style={{ color: t.danger }}>
              Не удалось загрузить файлы.
            </Text>
            <Pressable
              onPress={() => refetch()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку файлов"
              className="active:opacity-60"
            >
              <Text className="text-[12px] font-semibold" style={{ color: t.accent }}>
                Повторить
              </Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View className="flex-row items-center gap-1.5 py-1">
            <Paperclip color={t.faint} size={12} />
            <Text className="text-[12px] italic" style={{ color: t.faint }}>
              Файлов пока нет
            </Text>
          </View>
        ) : (
          <View className="flex-row flex-wrap gap-1.5">
            {items.map((a) => (
              <View
                key={a.id}
                className="relative aspect-square w-[31%] overflow-hidden rounded-[10px]"
                style={{ backgroundColor: t.fill }}
              >
                <Pressable
                  onPress={() => open(a)}
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть ${a.filename}`}
                  className="h-full w-full items-center justify-center active:opacity-80"
                >
                  {isImage(a) && thumbs[a.id] ? (
                    <Image
                      source={{ uri: thumbs[a.id] }}
                      resizeMode="cover"
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <View className="items-center">
                      <FileText color={t.sub} size={22} strokeWidth={2} />
                      <Text
                        className="mt-1 text-[10px] uppercase tracking-wider"
                        style={{ color: t.sub }}
                      >
                        {(a.filename.split(".").pop() ?? "файл").slice(0, 4)}
                      </Text>
                    </View>
                  )}
                  {opening === a.id ? (
                    <View
                      className="absolute inset-0 items-center justify-center"
                      style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
                    >
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : null}
                </Pressable>

                <View
                  pointerEvents="none"
                  className="absolute inset-x-0 bottom-0 flex-row items-center justify-between gap-1 px-1.5 py-0.5"
                  style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                >
                  <Text className="flex-1 text-[9px] text-white" numberOfLines={1}>
                    {a.filename}
                  </Text>
                  <Text className="text-[9px] text-white opacity-80">
                    {formatBytes(a.size_bytes)}
                  </Text>
                </View>

                <Pressable
                  onPress={() => confirmDelete(a)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить ${a.filename}`}
                  className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full active:opacity-70"
                  style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
                >
                  <X color="#fff" size={11} strokeWidth={2.4} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </CollapsibleCard>
  );
}
