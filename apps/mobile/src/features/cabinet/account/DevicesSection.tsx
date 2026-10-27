import { useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow } from "@/components/ui/card-rows";
import { signOutScopeAndWipe, unsentChangesNow } from "@/lib/auth-clear";
import { forgetOtherDevices } from "@/lib/push-device";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { writeErrorWords } from "@/lib/connection-words";
import { isHumanText } from "@babun/shared/i18n/runtime";

// ─── Устройства: выход на других / глобальный выход ─────────────────
export function DevicesSection() {
  const [busy, setBusy] = useState(false);

  // Веб-паритет (DevicesSection scope:"others"): гасит чужие сессии,
  // текущая остаётся жить — «потерял старый телефон», не «паника».
  const signOutOthers = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
      // Их сессии отозваны — пуши с клиентами туда тоже больше не идут.
      await forgetOtherDevices();
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
    // окне, а не вторым.
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

  // СТРОКИ — КАНОНИЧЕСКИЕ `ActionRow`: выход с других устройств и со всех.
  // Строки «Это устройство · В сети» нет — она не читала ничего и была
  // одинаковой и офлайн, и с протухшим входом.
  const askOthers = () =>
    confirmThen(
      "Выйти на других устройствах",
      {
        message: "Это устройство останется в системе",
        confirmLabel: "Выйти",
        destructive: true,
      },
      () => void signOutOthers(),
    );
  return (
    <SectionCard title="Устройства">
      <ActionRow label="Выйти на других устройствах" dimmed={busy} onPress={askOthers} />
      <ActionRow
        separated
        label="Выйти со всех устройств"
        tone="danger"
        dimmed={busy}
        onPress={() => void signOutEverywhere()}
      />
    </SectionCard>
  );
}
