import { Image, Pressable, Text, View } from "react-native";
import { FileText, Play, Trash2, type LucideIcon } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { Spinner } from "@/components/ui/Spinner";
import { formatBytes, type ClientAttachment } from "@/features/clients/card-attachments";
import { useThemeColors } from "@/theme/colors";
import { docTitle, isVideoPath } from "./appointment-files";

// ПЛИТКИ БЛОКА «ФАЙЛЫ» — только вид (STORY-070). Три в ряд, квадрат, сквиркл
// карточки. Фото — картинка, видео — значок «play» на подложке (кадра-превью
// пока нет), документ — значок и имя. Корзинка в углу — единственный
// видимый путь к удалению (владелец: «сейчас я не знаю, как удалить
// фотографию»), удержание плитки делает то же.

function useTile(size: number) {
  const t = useThemeColors();
  return {
    width: size,
    height: size,
    borderRadius: t.radius.card,
    borderCurve: "continuous" as const,
    overflow: "hidden" as const,
    backgroundColor: t.fill,
  };
}

function TrashBadge({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.ink}8c`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Trash2 color="#ffffff" size={12} strokeWidth={2.4} />
    </Pressable>
  );
}

export function PhotoTile({
  photo,
  size,
  deleting,
  onOpen,
  onDelete,
}: {
  photo: AppointmentPhotoRecord;
  size: number;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useThemeColors();
  const tile = useTile(size);
  const video = isVideoPath(photo.storage_path);
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onDelete}
      disabled={deleting}
      accessibilityRole="imagebutton"
      accessibilityLabel={video ? "Видео записи" : "Фото записи"}
      accessibilityHint="Удерживайте, чтобы удалить"
      style={({ pressed }) => [tile, { opacity: pressed || deleting ? 0.6 : 1 }]}
    >
      {video ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${t.ink}b3`,
            }}
          >
            <Play color="#ffffff" size={18} strokeWidth={2.4} fill="#ffffff" />
          </View>
        </View>
      ) : (
        <Image source={{ uri: photo.url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      )}
      <TrashBadge label={video ? "Удалить видео" : "Удалить фото"} onPress={onDelete} disabled={deleting} />
      {deleting ? (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Spinner size={20} label="Удаляем" />
        </View>
      ) : null}
    </Pressable>
  );
}

export function DocTile({
  doc,
  size,
  deleting,
  onOpen,
  onDelete,
}: {
  doc: ClientAttachment;
  size: number;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useThemeColors();
  const tile = useTile(size);
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel={`Документ ${doc.filename}`}
      accessibilityHint="Удерживайте, чтобы удалить"
      style={({ pressed }) => [tile, { opacity: pressed ? 0.6 : 1, padding: 10, justifyContent: "space-between" }]}
    >
      <FileText color={t.accent} size={22} strokeWidth={2} />
      <TrashBadge label={`Удалить документ ${doc.filename}`} onPress={onDelete} disabled={deleting} />
      <View>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.ink }}>
          {docTitle(doc.filename)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>
          {formatBytes(doc.size_bytes)}
        </Text>
      </View>
    </Pressable>
  );
}

export function UploadingTile({ size }: { size: number }) {
  const tile = useTile(size);
  return (
    <View style={[tile, { alignItems: "center", justifyContent: "center" }]}>
      <Spinner size={22} label="Загрузка" />
    </View>
  );
}

/** Документ, который выписал сам продукт — инвойс, чек: открывается своим
 *  экраном, корзинки нет (его не удаляют, его аннулируют там, где выписали).
 *  Владелец 2026-09-06: «то, что мы генерируем, автоматически закидывается в
 *  файлы, и там чётко написано, что это и за что». */
export function GeneratedDocTile({
  icon: Icon,
  title,
  subtitle,
  size,
  onOpen,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  size: number;
  onOpen: () => void;
}) {
  const t = useThemeColors();
  const tile = useTile(size);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [tile, { opacity: pressed ? 0.6 : 1, padding: 10, justifyContent: "space-between" }]}
    >
      <Icon color={t.accent} size={22} strokeWidth={2} />
      <View>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
