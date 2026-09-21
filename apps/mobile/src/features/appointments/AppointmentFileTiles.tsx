import { Image, Pressable, Text, View } from "react-native";
import { FileText, Play, Trash2, type LucideIcon } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { Spinner } from "@/components/ui/Spinner";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { docTitle, isVideoPath } from "./appointment-files";
import type { PendingFile } from "./appointment-files";

// ПЛИТКИ БЛОКА «ФАЙЛЫ» — только вид (STORY-070; редизайн 20.09, владелец:
// «фотографии открываются квадратиком, обычный файл — плашкой, не квадратный
// значок, надпись, компактно»). Квадрат остаётся только у фото и видео — они
// мельче прежнего, чтобы в ряд помещалось 4–5, а не 3, и блок стал ниже.
// Документ, инвойс и чек — одна и та же горизонтальная плашка (значок +
// название), а не квадрат: «просто блок маленький с надписью… которое
// нажимаю, и оно открывается, вот и всё». Корзинка — единственный видимый
// путь удаления помимо удержания (владелец: «сейчас я не знаю, как удалить
// фотографию»).
//
// БЕЗ `onDelete` НЕТ НИ КОРЗИНКИ, НИ УДЕРЖАНИЯ (15.09): мастеру сервер удалять
// файлы записи не даёт, и корзинка обещала бы то, что кончится ошибкой.

/** Квадрат фото/видео — фиксированный размер, а не доля ширины карточки
 *  (владелец 20.09: «мельче», чтобы в ряд помещалось 4–5, а не 3). */
const PHOTO_TILE_SIZE = 64;
const TRASH_BADGE_SIZE = 20;
const PLAY_BADGE_SIZE = 26;
const PILL_HEIGHT = 34;
const PILL_TITLE_MAX_WIDTH = 160;

function squareTile(t: ThemeColors, size: number) {
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
        top: 3,
        right: 3,
        width: TRASH_BADGE_SIZE,
        height: TRASH_BADGE_SIZE,
        borderRadius: TRASH_BADGE_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.ink}8c`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Trash2 color="#ffffff" size={10} strokeWidth={2.4} />
    </Pressable>
  );
}

/** Маленький крестик в конце плашки документа — тот же смысл, что у
 *  `TrashBadge` над фото, но вписан в строку, а не висит поверх картинки
 *  (владелец 20.09: «крестик… рисуй маленькой, у правого края»). */
function PillDeleteButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
    >
      <Trash2 color={t.sub} size={12} strokeWidth={2.2} />
    </Pressable>
  );
}

/** Кружок «play» на подложке видео — общий вид для сохранённого файла и
 *  файла в очереди новой записи, чтобы обе плитки читались одинаково. */
function VideoPlayBadge() {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: PLAY_BADGE_SIZE,
          height: PLAY_BADGE_SIZE,
          borderRadius: PLAY_BADGE_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${t.ink}b3`,
        }}
      >
        <Play color="#ffffff" size={12} strokeWidth={2.4} fill="#ffffff" />
      </View>
    </View>
  );
}

export function PhotoTile({
  photo,
  deleting,
  onOpen,
  onDelete,
}: {
  photo: AppointmentPhotoRecord;
  deleting: boolean;
  onOpen: () => void;
  /** Нет — удалять нельзя: ни корзинки, ни удержания. */
  onDelete?: () => void;
}) {
  const t = useThemeColors();
  const tile = squareTile(t, PHOTO_TILE_SIZE);
  const video = isVideoPath(photo.storage_path);
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onDelete}
      disabled={deleting}
      accessibilityRole="imagebutton"
      accessibilityLabel={video ? "Видео записи" : "Фото записи"}
      accessibilityHint={onDelete ? "Удерживайте, чтобы удалить" : undefined}
      style={({ pressed }) => [tile, { opacity: pressed || deleting ? 0.6 : 1 }]}
    >
      {video ? (
        <VideoPlayBadge />
      ) : (
        <Image source={{ uri: photo.url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      )}
      {onDelete ? (
        <TrashBadge label={video ? "Удалить видео" : "Удалить фото"} onPress={onDelete} disabled={deleting} />
      ) : null}
      {deleting ? (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Spinner size={18} label="Удаляем" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Компактная горизонтальная плашка документа — заменяет прежние квадраты
 *  `DocTile` и `GeneratedDocTile` (владелец 20.09: «не квадратный значок,
 *  а маленький блок с надписью — название, которое нажимаю, и оно
 *  открывается, вот и всё»). Один вид на файл клиента, инвойс и чек:
 *  различает их только иконка и название, которые задаёт вызывающий блок —
 *  сама плашка ничего не знает про источник данных. */
export function DocumentPill({
  icon: Icon,
  title,
  deleting,
  onOpen,
  onDelete,
}: {
  icon: LucideIcon;
  title: string;
  deleting?: boolean;
  onOpen: () => void;
  /** Нет — удалять нельзя: инвойс и чек не удаляются вовсе, их аннулируют
   *  там, где выписали. */
  onDelete?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={onDelete ? "Удерживайте, чтобы удалить" : undefined}
      // Крестик в плашке мелкий и у самого края — на случай промаха пальцем
      // то же действие живёт ротором VoiceOver (владелец 20.09).
      accessibilityActions={onDelete ? [{ name: "delete", label: "Удалить" }] : undefined}
      onAccessibilityAction={
        onDelete
          ? (e) => {
              if (e.nativeEvent.actionName === "delete") onDelete();
            }
          : undefined
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        height: PILL_HEIGHT,
        borderRadius: t.radius.input,
        borderCurve: "continuous",
        backgroundColor: t.fill,
        paddingLeft: 10,
        paddingRight: onDelete ? 6 : 10,
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon color={t.accent} size={15} strokeWidth={2} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={{ maxWidth: PILL_TITLE_MAX_WIDTH, fontSize: 14, fontWeight: "600", color: t.ink }}
      >
        {title}
      </Text>
      {onDelete ? <PillDeleteButton label={`Удалить ${title}`} onPress={onDelete} disabled={!!deleting} /> : null}
    </Pressable>
  );
}

export function UploadingTile() {
  const t = useThemeColors();
  const tile = squareTile(t, PHOTO_TILE_SIZE);
  return (
    <View style={[tile, { alignItems: "center", justifyContent: "center" }]}>
      <Spinner size={20} label="Загрузка" />
    </View>
  );
}

/** Плашка загрузки документа — тот же язык, что у `UploadingTile`, но в
 *  форме пилюли: документ грузится плашкой, а не квадратом (владелец 20.09). */
export function UploadingDocumentPill() {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: 90,
        height: PILL_HEIGHT,
        borderRadius: t.radius.input,
        borderCurve: "continuous",
        backgroundColor: t.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner size={16} label="Загрузка" />
    </View>
  );
}

/** Файл новой записи: ещё не уехал, ждёт «Создать запись». Медиа — квадрат,
 *  как у сохранённого фото; документ — та же плашка, что у сохранённого
 *  файла (владелец 20.09: разница только в источнике данных, не во виде). */
export function PendingTile({ file, onDelete }: { file: PendingFile; onDelete: () => void }) {
  const t = useThemeColors();
  if (file.kind === "document") {
    return (
      <View
        accessible
        accessibilityLabel={`Документ ${file.name}, добавится при создании`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: PILL_HEIGHT,
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          backgroundColor: t.fill,
          paddingLeft: 10,
          paddingRight: 6,
          gap: 6,
        }}
      >
        <FileText color={t.accent} size={15} strokeWidth={2} />
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={{ maxWidth: PILL_TITLE_MAX_WIDTH, fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          {docTitle(file.name)}
        </Text>
        <PillDeleteButton label={`Убрать ${file.name}`} onPress={onDelete} />
      </View>
    );
  }
  const tile = squareTile(t, PHOTO_TILE_SIZE);
  return (
    <View
      style={tile}
      accessible
      accessibilityLabel={`${file.video ? "Видео" : "Фото"} ${file.name}, добавится при создании`}
    >
      {file.previewUri ? (
        <Image source={{ uri: file.previewUri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      ) : file.video ? (
        <VideoPlayBadge />
      ) : null}
      <TrashBadge label={`Убрать ${file.name}`} onPress={onDelete} disabled={false} />
    </View>
  );
}
