import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Smartphone } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { signOutScopeAndWipe, unsentChangesNow } from "@/lib/auth-clear";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { writeErrorWords } from "@/lib/connection-words";
import { isHumanText } from "@babun/shared/i18n/runtime";

// ─── Устройства: выход на других / глобальный выход ─────────────────
export function DevicesSection() {
  const t = useThemeColors();
  const [busy, setBusy] = useState(false);

  // Веб-паритет (DevicesSection scope:"others"): гасит чужие сессии,
  // текущая остаётся жить — «потерял старый телефон», не «паника».
  const signOutOthers = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
      notify("Готово", "Сессии на других устройствах завершены.");
    } catch (e) {
      const words = writeErrorWords(e, {
        failed: "Не удалось выйти",
        notDone: "Другие устройства остались в аккаунте",
      });
      notify(words.title, isHumanText(words.subtitle) ? words.subtitle : "Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    // Очередь правок стирается вместе с кэшем — сказать об этом в том же
    // окне, а не вторым (аудит 03.10).
    const unsent = await unsentChangesNow();
    confirmThen(
      "Выйти со всех устройств?",
      {
        message: unsent
          ? `Все сессии, включая это устройство, будут завершены. ${unsent}`
          : "Все сессии, включая это устройство, будут завершены.",
        confirmLabel: "Выйти везде",
        destructive: true,
      },
      async () => {
        setBusy(true);
        try {
          // scope: "global" отзывает refresh-токены всех устройств;
          // локальная сессия тоже гаснет → SessionProvider уводит на
          // логин. Wipe — только ПОСЛЕ успешного signOut (офлайн-
          // ошибка не должна уничтожать локальные данные).
          // SessionProvider waits for this helper's wipe barrier before
          // it exposes the signed-out/login tree.
          await signOutScopeAndWipe("global");
        } catch (e) {
          const words = writeErrorWords(e, {
            failed: "Не удалось выйти",
            notDone: "Устройства остались в аккаунте",
          });
          notify(words.title, isHumanText(words.subtitle) ? words.subtitle : "Попробуйте ещё раз.");
        } finally {
          setBusy(false);
        }
      },
    );
  };

  return (
    <SectionCard title="Устройства">
      <View className="flex-row items-center px-4 py-3">
        <View
          style={{
            height: 32,
            width: 32,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            backgroundColor: "rgba(44,91,224,0.10)",
          }}
        >
          <Smartphone color={t.accent} size={ICON.sm} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base" style={{ color: t.ink }}>
            Это устройство
          </Text>
          <Text className="text-xs" style={{ color: t.sub }}>
            В сети · текущая сессия
          </Text>
        </View>
      </View>
      <Divider inset={56} />
      <Pressable
        onPress={() => void signOutOthers()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Выйти на других устройствах"
        className="px-4 py-3.5 active:opacity-60"
        style={{ minHeight: 44, opacity: busy ? 0.5 : 1 }}
      >
        <Text className="text-base" style={{ color: t.ink }}>
          Выйти на других устройствах
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
          Это устройство останется в системе
        </Text>
      </Pressable>
      <Divider inset={16} />
      <Pressable
        onPress={() => void signOutEverywhere()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Выйти со всех устройств"
        className="px-4 py-3.5 active:opacity-60"
        style={{ minHeight: 44, opacity: busy ? 0.5 : 1 }}
      >
        <Text className="text-base" style={{ color: t.danger }}>
          Выйти со всех устройств
        </Text>
      </Pressable>
    </SectionCard>
  );
}
