import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { Screen } from "@/components/ui/Screen";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useCreateClient } from "@/features/clients/queries";
import { tryToE164 } from "@/features/clients/phone";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";

export default function NewClientScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const tenantId = useTenantId();
  const create = useCreateClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // clients-99 F1.5 — inline dedup guard (approved add-client решение):
  // a phone_e164 hit shows «Открыть» instead of silently creating a dup.
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const [checking, setChecking] = useState(false);

  // Save-gate: phone is the primary required field (add-client design).
  const canSave = phone.trim().length > 0 && !create.isPending && !checking;

  async function handleCreate() {
    setError(null);
    const trimmedPhone = phone.trim();
    // clients-99 F1.4 — normalize to E.164 for the dedup index; the raw
    // input is preserved in `phone` (web parity).
    const e164 = tryToE164(trimmedPhone);

    // First tap checks for an existing client with the same number;
    // while the duplicate banner is visible a second tap force-creates
    // (mirrors the web forceCreateDuplicate escape hatch).
    if (e164 && !duplicate) {
      setChecking(true);
      try {
        const existing = await findClientByPhoneE164(
          supabase,
          e164,
          tenantId as string,
        );
        if (existing) {
          setDuplicate(existing);
          return;
        }
      } catch {
        // Network blip — let the save proceed; the DB unique index is
        // the ultimate guarantee (web parity).
      } finally {
        setChecking(false);
      }
    }

    try {
      const c = await create.mutateAsync({
        phone: trimmedPhone,
        full_name: name.trim(),
        phone_e164: e164,
      });
      router.replace(`/clients/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen edges={["top"]}>
      <View
        className="flex-row items-center border-b px-2 py-2"
        style={{ borderColor: t.separator }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel="Назад"
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-60"
        >
          <ChevronLeft color={t.body} size={22} />
        </Pressable>
        <Text
          className="flex-1 text-base font-semibold"
          style={{ color: t.ink }}
        >
          Новый клиент
        </Text>
      </View>

      <View className="px-6 pt-6">
        <Field
          label="Телефон"
          value={phone}
          onChangeText={(v: string) => {
            setPhone(v);
            // Edited number → the previous duplicate check is stale.
            setDuplicate(null);
          }}
          keyboardType="phone-pad"
          placeholder="+357 99 123456"
          autoFocus
        />
        <Field
          label="Имя"
          value={name}
          onChangeText={setName}
          placeholder="Имя клиента"
        />
        {duplicate ? (
          <View
            className="mb-3 flex-row items-center gap-3 rounded-2xl p-3"
            style={{ backgroundColor: `${t.warning}1a` }}
          >
            <View className="flex-1">
              <Text
                className="text-sm font-semibold"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {duplicate.full_name || duplicate.phone || "Клиент"}
              </Text>
              <Text className="text-xs" style={{ color: t.sub }}>
                Этот номер уже в базе
              </Text>
            </View>
            <Pressable
              onPress={() => router.replace(`/clients/${duplicate.id}`)}
              className="rounded-xl px-3.5 py-2 active:opacity-80"
              style={{ backgroundColor: t.accent }}
            >
              <Text className="text-sm font-semibold" style={{ color: t.onAccent }}>
                Открыть
              </Text>
            </Pressable>
          </View>
        ) : null}
        {error ? (
          <Text className="mb-3 text-sm" style={{ color: t.danger }}>
            {error}
          </Text>
        ) : null}
        <Button
          label={duplicate ? "Создать всё равно" : "Создать"}
          onPress={handleCreate}
          disabled={!canSave}
          loading={create.isPending || checking}
        />
      </View>
    </Screen>
  );
}
