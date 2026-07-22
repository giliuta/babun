import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import {
  useCurrentRole,
  useTenant,
  useUpdateTenant,
} from "@/features/settings/tenant";

type FormKey =
  | "name"
  | "city"
  | "contact_phone"
  | "contact_email"
  | "contact_whatsapp"
  | "legal_name"
  | "business_address"
  | "vat_number"
  | "iban"
  | "bank_name"
  | "invoice_prefix";

const EMPTY: Record<FormKey, string> = {
  name: "",
  city: "",
  contact_phone: "",
  contact_email: "",
  contact_whatsapp: "",
  legal_name: "",
  business_address: "",
  vat_number: "",
  iban: "",
  bank_name: "",
  invoice_prefix: "",
};

export default function BusinessScreen() {
  const t = useThemeColors();
  const { data: tenant, isLoading, error, refetch } = useTenant();
  const { data: role } = useCurrentRole();
  const update = useUpdateTenant();
  const [form, setForm] = useState<Record<FormKey, string>>(EMPTY);
  const [dirty, setDirty] = useState(false);

  // RLS (tenants_update_owner) allows saving to the owner only — disable
  // upfront instead of letting the save fail with an opaque error.
  const owner = role === "owner";
  const readOnly = !owner;

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name ?? "",
      city: tenant.city ?? "",
      contact_phone: tenant.contact_phone ?? "",
      contact_email: tenant.contact_email ?? "",
      contact_whatsapp: tenant.contact_whatsapp ?? "",
      legal_name: tenant.legal_name ?? "",
      business_address: tenant.business_address ?? "",
      vat_number: tenant.vat_number ?? "",
      iban: tenant.iban ?? "",
      bank_name: tenant.bank_name ?? "",
      invoice_prefix: tenant.invoice_prefix ?? "",
    });
    setDirty(false);
  }, [tenant]);

  const set = (k: FormKey) => (v: string) => {
    setForm((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    if (!owner) return;
    try {
      const clean = (v: string) => (v.trim() ? v.trim() : null);
      await update.mutateAsync({
        name: form.name.trim() || tenant?.name || "",
        city: clean(form.city),
        contact_phone: clean(form.contact_phone),
        contact_email: clean(form.contact_email),
        contact_whatsapp: clean(form.contact_whatsapp),
        legal_name: clean(form.legal_name),
        business_address: clean(form.business_address),
        vat_number: clean(form.vat_number),
        iban: clean(form.iban),
        bank_name: clean(form.bank_name),
        invoice_prefix: form.invoice_prefix.trim(),
      });
      setDirty(false);
      Alert.alert("Сохранено", "Профиль обновлён.");
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  if (isLoading || error) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Личная информация" />
        {isLoading ? (
          <EmptyState state="loading" fill />
        ) : (
          <EmptyState
            state="error"
            fill
            subtitle={(error as Error).message}
            action={{ label: "Повторить", onPress: () => void refetch() }}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Личная информация" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard title="Компания" padded>
          <Field label="Название" value={form.name} onChangeText={set("name")} placeholder="AirFix" editable={owner} />
          <Field label="Город" value={form.city} onChangeText={set("city")} placeholder="Limassol" editable={owner} />
        </SectionCard>

        <SectionCard title="Контакты" padded>
          <Field
            label="Телефон"
            value={form.contact_phone}
            onChangeText={set("contact_phone")}
            placeholder="+357…"
            keyboardType="phone-pad"
            editable={owner}
          />
          <Field
            label="Email"
            value={form.contact_email}
            onChangeText={set("contact_email")}
            placeholder="info@…"
            keyboardType="email-address"
            editable={owner}
          />
          <Field
            label="WhatsApp"
            value={form.contact_whatsapp}
            onChangeText={set("contact_whatsapp")}
            placeholder="+357…"
            keyboardType="phone-pad"
            editable={owner}
          />
        </SectionCard>

        {owner ? (
          <SectionCard title="Реквизиты для счетов" padded>
            <Field label="Юр. название" value={form.legal_name} onChangeText={set("legal_name")} />
            <Field
              label="Юридический адрес"
              value={form.business_address}
              onChangeText={set("business_address")}
              placeholder="Адрес для инвойсов"
            />
            <Field label="VAT / рег. номер" value={form.vat_number} onChangeText={set("vat_number")} />
            <Field label="IBAN" value={form.iban} onChangeText={set("iban")} />
            <Field label="Банк" value={form.bank_name} onChangeText={set("bank_name")} />
            <Field
              label="Префикс счёта"
              value={form.invoice_prefix}
              onChangeText={set("invoice_prefix")}
              placeholder="INV-"
            />
          </SectionCard>
        ) : null}

        <View className="mx-3 mt-5">
          {readOnly ? (
            <Text
              className="mb-2 text-center text-xs"
              style={{ color: t.sub }}
            >
              Изменять профиль бизнеса может только владелец.
            </Text>
          ) : null}
          <Button
            label="Сохранить"
            onPress={save}
            disabled={!dirty || readOnly || update.isPending}
            loading={update.isPending}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
