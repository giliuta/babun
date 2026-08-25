import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImagePlus, X } from "lucide-react-native";
import { randomUuid } from "@babun/shared/sync";
import { Spinner } from "@/components/ui/Spinner";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";

// ЛОГОТИП КОМПАНИИ — ШАПКА КАЖДОГО ДОКУМЕНТА.
//
// Владелец 2026-08-10: «добавить логотип». Кладём в ПУБЛИЧНЫЙ бакет: ссылка
// печатается в PDF, который живёт у клиента годами, а подписанная ссылка
// протухает за минуты и оставила бы в отправленном счёте дыру вместо картинки.
//
// Файл каждый раз новый (uuid), а не перезапись «logo.png»: у отправленных
// документов остаётся ровно тот логотип, с которым их выслали, и кэш телефона
// не показывает вчерашнюю картинку.
//
// КАМЕРЫ ЗДЕСЬ НЕТ. Владелец 2026-08-10: «лого никогда в жизни не снимается
// камерой, поэтому только загрузить». Один тап — фотоплёнка, без листа выбора
// с единственным осмысленным пунктом.

const BUCKET = "tenant-logos";
const MAX_BYTES = 5 * 1024 * 1024;

export function LogoRow({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const t = useThemeColors();
  const tenantId = useTenantId();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    try {
      // quality сжимает картинку при выгрузке: снимок экрана с логотипом из
      // фотоплёнки легко весит больше пяти мегабайт, а в шапке инвойса он
      // печатается шириной в два сантиметра.
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset?.uri || !tenantId) return;

      setBusy(true);
      const response = await fetch(asset.uri);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) {
        throw new Error("Картинка больше 5 МБ — выберите файл поменьше");
      }
      const mime = asset.mimeType ?? "image/png";
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      const path = `${tenantId}/${randomUuid()}.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      Alert.alert("Не удалось загрузить логотип", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View
          className="items-center justify-center overflow-hidden rounded-[10px]"
          style={{ width: 64, height: 44, backgroundColor: t.fill }}
        >
          {busy ? (
            <Spinner size={18} />
          ) : logoUrl ? (
            <Image
              source={{ uri: logoUrl }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={{ width: 60, height: 40 }}
            />
          ) : (
            <ImagePlus color={t.faint} size={18} strokeWidth={2} />
          )}
        </View>
        <Pressable
          onPress={() => void pick()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={logoUrl ? "Заменить логотип" : "Загрузить логотип"}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          <Text className="text-base font-semibold" style={{ color: t.accent }}>
            {logoUrl ? "Заменить логотип" : "Загрузить логотип"}
          </Text>
          <Text className="mt-0.5 text-xs" style={{ color: t.faint }}>
            Печатается в шапке инвойса
          </Text>
        </Pressable>
        {logoUrl && !busy ? (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Убрать логотип"
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <X color={t.sub} size={18} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

    </>
  );
}
