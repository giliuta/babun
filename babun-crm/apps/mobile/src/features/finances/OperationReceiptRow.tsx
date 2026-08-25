import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Camera, FileText, FileUp, Images, Paperclip, X } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Spinner } from "@/components/ui/Spinner";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import {
  deleteOperationReceipt,
  discardOperationReceiptIfOrphan,
  uploadOperationReceipt,
  useSignedReceiptUrl,
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
}: {
  receiptUrl: string | null;
  onPick: (path: string | null) => void;
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const [busy, setBusy] = useState(false);
  // Лист выбора живёт ЗДЕСЬ, а не в корневом хосте (chooseOption): корневой
  // лист рисуется под Modal операции и просто не виден. Вложенный — виден.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Что залили в этой форме. Снятый ЗДЕСЬ файл стирается из хранилища сразу:
  // иначе каждая опечатка («не тот чек») оставляла бы мусор навсегда.
  // Документ уже сохранённой операции не трогаем — он часть истории.
  const uploadedHere = useRef<Set<string>>(new Set());
  const unmounted = useRef(false);
  // Закрытие листа БЕЗ сохранения — тот же случай мусора: файл уже в бакете,
  // а операция с ним так и не записана. Крестик формы про это не узнает,
  // поэтому подчищаем на размонтировании; сохранённый файл переживёт чистку —
  // discardOperationReceiptIfOrphan удаляет только то, на что не ссылается
  // ни одна операция.
  useEffect(
    () => () => {
      unmounted.current = true;
      for (const path of uploadedHere.current) {
        void discardOperationReceiptIfOrphan(path);
      }
    },
    [],
  );
  const signed = useSignedReceiptUrl(receiptUrl);

  const attach = async (from: "camera" | "gallery" | "file") => {
    try {
      if (from === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
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

      // «Занято» включается ТОЛЬКО на загрузку. Раньше оно включалось перед
      // системным выбором файла, и если тот не открывался, строка навсегда
      // застревала на «Загружаем документ…».
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
      setBusy(true);
      const path = await uploadOperationReceipt(
        {
          uri: asset.uri,
          name: "name" in asset ? asset.name : (asset.fileName ?? null),
          mimeType: asset.mimeType ?? null,
          size: "size" in asset ? (asset.size ?? null) : null,
        },
        tenantId,
      );
      // Лист закрыли, пока файл летел: показать и сохранить его уже некому,
      // а чистка размонтирования прошла до конца загрузки — убираем сами.
      if (unmounted.current) {
        void deleteOperationReceipt(path).catch(() => {});
        return;
      }
      uploadedHere.current.add(path);
      onPick(path);
    } catch (e) {
      Alert.alert("Не удалось приложить документ", (e as Error).message);
    } finally {
      setBusy(false);
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
          Загружаем документ…
        </Text>
      </View>
    );
  }

  if (receiptUrl) {
    return (
      <View className="flex-row items-center gap-3 px-4 py-3">
        <FileText color={t.accent} size={18} strokeWidth={2} />
        <Pressable
          onPress={() => signed && void Linking.openURL(signed)}
          disabled={!signed}
          accessibilityRole="button"
          accessibilityLabel="Открыть приложенный документ"
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            className="text-base"
            maxFontSizeMultiplier={1.3}
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            Документ приложен
          </Text>
          <Text
            className="mt-0.5 text-xs"
            maxFontSizeMultiplier={1.3}
            style={{ color: t.sub }}
          >
            {signed ? "Нажмите, чтобы открыть" : "Готовим ссылку…"}
          </Text>
        </Pressable>
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
          accessibilityLabel="Убрать документ"
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <X color={t.sub} size={18} strokeWidth={2.2} />
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setPickerOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Приложить документ к операции"
        className="min-h-[48px] flex-row items-center gap-2 px-4 py-3"
        style={({ pressed }) => ({
          opacity: disabled ? 0.4 : 1,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Paperclip color={t.accent} size={18} strokeWidth={2} />
        <Text
          className="text-base font-semibold"
          maxFontSizeMultiplier={1.3}
          style={{ color: t.accent }}
        >
          Приложить документ
        </Text>
        <Text
          className="ml-auto text-xs"
          maxFontSizeMultiplier={1.3}
          style={{ color: t.faint }}
        >
          чек, инвойс
        </Text>
      </Pressable>

      <PickerSheet
        visible={pickerOpen}
        title="Документ к операции"
        onClose={() => setPickerOpen(false)}
        items={[
          {
            id: "camera",
            label: "Снять камерой",
            icon: Camera,
            color: t.accent,
            onPress: () => void attach("camera"),
          },
          {
            id: "gallery",
            label: "Из фотоплёнки",
            icon: Images,
            color: t.accent,
            onPress: () => void attach("gallery"),
          },
          {
            id: "file",
            label: "Выбрать файл",
            icon: FileUp,
            color: t.accent,
            onPress: () => void attach("file"),
          },
        ]}
      />
    </>
  );
}
