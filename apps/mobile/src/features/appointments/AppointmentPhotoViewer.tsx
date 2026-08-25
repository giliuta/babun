import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  AppointmentPhotoRecord,
  PhotoKind,
} from "@babun/shared/db/repositories/appointment-photos";
import { useThemeColors } from "@/theme/colors";
import { Spinner } from "@/components/ui/Spinner";

const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  before: "До работы",
  after: "После работы",
  other: "Фото",
};

export function AppointmentPhotoViewer({
  photo,
  onClose,
  onRetry,
}: {
  photo: AppointmentPhotoRecord | null;
  onClose: () => void;
  onRetry: () => Promise<boolean>;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(!!photo);
    setFailed(false);
  }, [photo]);

  if (!photo) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1" style={{ backgroundColor: t.canvas }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть фотографию"
          className="absolute right-4 z-10 h-11 w-11 items-center justify-center rounded-full"
          style={{ top: insets.top + 8, backgroundColor: t.fill }}
        >
          <X color={t.ink} size={22} strokeWidth={2.2} />
        </Pressable>
        <Image
          key={`${photo.url}:${attempt}`}
          source={{ uri: photo.url }}
          resizeMode="contain"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          style={{ flex: 1, width: "100%" }}
        />
        {loading ? (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <Spinner size={26} label="Загрузка фотографии" />
          </View>
        ) : null}
        {failed ? (
          <View className="absolute inset-0 items-center justify-center px-8">
            <Text className="text-center text-sm" style={{ color: t.sub }}>
              Не удалось открыть фотографию.
            </Text>
            <Pressable
              onPress={async () => {
                setLoading(true);
                setFailed(false);
                if (await onRetry()) {
                  setAttempt((current) => current + 1);
                } else {
                  setLoading(false);
                  setFailed(true);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку фотографии"
              className="mt-2 min-h-11 justify-center px-4 active:opacity-60"
            >
              <Text className="text-sm font-semibold" style={{ color: t.accent }}>
                Повторить
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View
          className="px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Text
            className="text-center text-sm font-semibold"
            style={{ color: t.ink }}
          >
            {PHOTO_KIND_LABEL[photo.kind]}
          </Text>
          {photo.caption ? (
            <Text className="mt-1 text-center text-sm" style={{ color: t.sub }}>
              {photo.caption}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
