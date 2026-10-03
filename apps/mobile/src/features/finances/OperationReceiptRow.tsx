import { useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Camera, FileText, Image as ImageIcon, Images, Paperclip, X } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SelectRow } from "@/components/ui/select-rows";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Spinner } from "@/components/ui/Spinner";
import { useTenantId } from "@/lib/tenant";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  deleteOperationReceipt,
  uploadOperationReceipt,
  useSignedReceiptUrl,
  type ReceiptSession,
} from "./receipt-upload";

// ДОКУМЕНТ, ПОДТВЕРЖДАЮЩИЙ ОПЕРАЦИЮ.
//
// Владелец 2026-08-09: «когда тратим расходы — отсканировать инвойс, чтобы к
// каждой сумме был документ». Бухгалтеру нужна не цифра, а бумага под ней:
// без чека расход не примут к зачёту, и НДС по нему не вернут.
//
// Два входа, потому что бумага приходит двумя путями: чек с заправки снимают
// камерой прямо на месте, а инвойс поставщика приходит файлом в почту.

export function OperationReceiptRow({
  receiptUrl,
  onPick,
  disabled,
  session,
}: {
  receiptUrl: string | null;
  onPick: (path: string | null) => void;
  disabled?: boolean;
  /** Залитое в этой форме — его чистит сама форма, когда закрыта насовсем
   *  (`useReceiptSession`). */
  session: ReceiptSession;
}) {
  const t = useThemeColors();
  const tenantId = useTenantId();
  // Слово над спиннером меняется по фазе: до системного пикера строка не
  // врёт словом «Загружаем» — там ещё нечего загружать, идёт лишь разрешение
  // камеры и пауза перед открытием нативного экрана.
  const [stage, setStage] = useState<"idle" | "opening" | "uploading">("idle");
  const busy = stage !== "idle";
  // Синхронный гард поверх стейта (тот же приём, что savingRef в
  // OperationSheet): `stage` меняется только после ре-рендера, а
  // сверхбыстрый двойной тап успевал открыть системный пикер дважды.
  const busyRef = useRef(false);
  // Лист выбора живёт ЗДЕСЬ, а не в корневом хосте (chooseOption): корневой
  // лист рисуется под Modal операции и просто не виден. Вложенный — виден.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Что залили в этой форме — живёт у ФОРМЫ (`session`), а не у строки:
  // лист снимает строку при каждом отъезде, и чистка на размонтировании
  // стирала файл, который форма ещё держала. Снятый ЗДЕСЬ файл стирается
  // сразу: иначе каждая опечатка («не тот чек») оставляла бы мусор. Документ
  // уже сохранённой операции не трогаем — он часть истории.
  const uploadedHere = session.uploads;
  const signed = useSignedReceiptUrl(receiptUrl);

  const attach = async (from: "camera" | "gallery" | "file") => {
    // «Занято» — С ТАПА, А НЕ С ЗАГРУЗКИ (прогон финансов 2026-09-24). До
    // открытия системного пикера уходит ~1с (разрешение камеры + пауза ниже),
    // и всё это время строка молчала — тап читался как не сработавший, и
    // случался повторный тап, открывавший ВТОРОЙ пикер поверх первого. Гейт
    // синхронный: `stage` из state успевает включиться только после ре-рендера,
    // а второй тап в тот же кадр — раньше.
    if (busyRef.current) return;
    busyRef.current = true;
    setStage("opening");
    // СТРАХОВКА ОТ ВЕЧНОГО «ОТКРЫВАЕМ…». Системный выбор иногда не
    // открывается вовсе, и его обещание не решается никогда — так строка уже
    // застревала на «Загружаем документ…». Через 1,5 с после тапа строка
    // оживает сама; открытый пикер к этому времени и так закрывает экран, а
    // загрузка снова включит «занято» своим этапом.
    const unstick = setTimeout(() => {
      busyRef.current = false;
      setStage((stage) => (stage === "opening" ? "idle" : stage));
    }, 1500);
    try {
      if (from === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          notify(
            "Нет доступа к камере",
            "Разрешите камеру: Настройки → Babun → Камера.",
          );
          return;
        }
      }
      // ЖДЁМ, ПОКА ЛИСТ ВЫБОРА ПОЛНОСТЬЮ УЕДЕТ. Системная камера/галерея —
      // это нативный экран поверх приложения, и если попросить его показаться,
      // пока закрывается предыдущее модальное окно, iOS молча не показывает
      // ничего: тап проваливался в пустоту. 240 мс листа не хватает.
      await new Promise((r) => setTimeout(r, 450));

      const picked =
        from === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 0.7,
            })
          : from === "gallery"
            ? await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.7,
              })
            : await DocumentPicker.getDocumentAsync({
                type: ["image/*", "application/pdf"],
                copyToCacheDirectory: true,
              });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset?.uri) return;
      clearTimeout(unstick);
      busyRef.current = true;
      setStage("uploading");
      const path = await uploadOperationReceipt(
        {
          uri: asset.uri,
          name: "name" in asset ? asset.name : (asset.fileName ?? null),
          mimeType: asset.mimeType ?? null,
          size: "size" in asset ? (asset.size ?? null) : null,
        },
        tenantId,
      );
      // Форма могла уехать, пока файл летел: она держит черновик и получит
      // файл; не сохранят — сотрёт при окончательном закрытии.
      uploadedHere.current.add(path);
      onPick(path);
    } catch (e) {
      notify("Не удалось приложить документ", (e as Error).message);
    } finally {
      clearTimeout(unstick);
      busyRef.current = false;
      setStage("idle");
    }
  };

  if (busy) {
    return (
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Spinner size={18} />
        <Text
          className="text-base"
          maxFontSizeMultiplier={1.3}
          style={{ color: t.sub }}
        >
          {stage === "uploading" ? "Загружаем документ…" : "Открываем…"}
        </Text>
      </View>
    );
  }

  if (receiptUrl) {
    // ПЛАШКА, КАК ФАЙЛ КЛИЕНТА (владелец 03.10: «файлы сделаем такие, как в
    // клиентах»): снимок — плиткой с самим фото, документ — значком файла.
    // Тап открывает файл, крестик справа снимает его с операции.
    const photo = isImagePath(receiptUrl);
    return (
      <View style={{ paddingHorizontal: 2, paddingVertical: 2 }}>
        <SelectRow
          icon={photo ? ImageIcon : FileText}
          color={t.accent}
          image={photo && signed ? signed : undefined}
          plain
          title={photo ? "Фото" : "Документ"}
          accessibilityLabel={photo ? "Фото к операции" : "Документ к операции"}
          accessibilityHint="Открывает файл"
          onPress={() => signed && void Linking.openURL(signed)}
          trailing={
            <Pressable
              onPress={() => {
                if (receiptUrl && uploadedHere.current.has(receiptUrl)) {
                  uploadedHere.current.delete(receiptUrl);
                  void deleteOperationReceipt(receiptUrl).catch(() => {});
                }
                onPick(null);
              }}
              disabled={disabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Убрать файл"
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <X color={t.sub} size={18} strokeWidth={2.2} />
            </Pressable>
          }
        />
      </View>
    );
  }

  return (
    <>
      {/* СТРОКА «ДОБАВИТЬ ФАЙЛ» — ТА ЖЕ, ЧТО В БЛОКЕ «ФАЙЛЫ» КЛИЕНТА
          (владелец 03.10: «файлы сделаем такие, как в клиентах»): скрепка в
          круге, слово, стрелка. */}
      <ChooseRow
        compact
        icon={Paperclip}
        label="Добавить файл"
        disabled={disabled}
        onPress={() => setPickerOpen(true)}
      />

      {/* Пункты и слова — как в листе «Добавить» файлов клиента
          (`FileAddSheet`); чеку видео не нужно — только снимок или файл. */}
      <PickerSheet
        visible={pickerOpen}
        title="Добавить"
        onClose={() => setPickerOpen(false)}
        items={[
          {
            id: "camera",
            label: "Снять фото",
            icon: Camera,
            color: t.accent,
            onPress: () => void attach("camera"),
          },
          {
            id: "gallery",
            label: "Выбрать из галереи",
            icon: Images,
            color: t.accent,
            onPress: () => void attach("gallery"),
          },
          {
            id: "file",
            label: "Выбрать файл",
            icon: FileText,
            color: t.accent,
            onPress: () => void attach("file"),
          },
        ]}
      />
    </>
  );
}

/** Снимок или документ — по расширению пути в бакете чеков. */
function isImagePath(path: string): boolean {
  return /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(path.trim());
}
