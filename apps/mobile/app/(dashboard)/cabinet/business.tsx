import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { LogoRow } from "@/features/settings/LogoRow";
import { Button } from "@/components/ui/Button";
import { ChevronRight } from "lucide-react-native";
import {
  COUNTRY_NAMES_RU,
  countryDialCode,
  normalizeCountry,
  SUPPORTED_COUNTRIES,
} from "@/features/clients/phone";
import { chooseValue } from "@/lib/choose";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  useCurrentRole,
  useTenant,
  useUpdateTenant,
} from "@/features/settings/tenant";

type FormKey =
  | "name"
  | "city"
  | "country"
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
  country: "",
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

  const country = normalizeCountry(form.country);
  const countryLabel = `${COUNTRY_NAMES_RU[country] ?? country} · ${countryDialCode(country)}`;
  const pickCountry = async () => {
    const picked = await chooseValue<string>(
      "Код страны",
      SUPPORTED_COUNTRIES.map((code) => ({
        value: code as string,
        label: `${COUNTRY_NAMES_RU[code] ?? code} · ${countryDialCode(code)}`,
      })),
    );
    if (!picked?.value) return;
    setForm((cur) => ({ ...cur, country: picked.value as string }));
    setDirty(true);
  };

  // RLS (tenants_update_owner) allows saving to the owner only — disable
  // upfront instead of letting the save fail with an opaque error.
  const owner = role === "owner";
  const readOnly = !owner;

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name ?? "",
      city: tenant.city ?? "",
      country: tenant.country ?? "",
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
        // Код страны храним как ISO-код («CY»): из него выводится и «+357»
        // в поле нового клиента, и разбор местного номера без «+».
        country: country,
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
      notify("Сохранено", "Профиль обновлён.");
    } catch (e) {
      notify("Ошибка", (e as Error).message);
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
          {/* КОД СТРАНЫ — свойство компании (владелец 2026-07-26: «чтобы он
              ставил автоматически… в настройках можно было сразу выбирать»).
              Не команда: номер принадлежит клиенту, а не команде; не
              устройство: иначе у владельца и диспетчера новые клиенты
              заводились бы с разными кодами и ключ дедупа расходился бы. */}
          <Pressable
            onPress={owner ? () => void pickCountry() : undefined}
            disabled={!owner}
            accessibilityRole="button"
            accessibilityLabel={`Код страны: ${countryLabel}`}
            accessibilityState={{ disabled: !owner }}
            style={({ pressed }) => ({
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              opacity: owner ? (pressed ? 0.6 : 1) : 0.5,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              Код страны
            </Text>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{ fontSize: 15, fontWeight: "500", color: t.ink }}
              >
                {countryLabel}
              </Text>
            </View>
            {owner ? (
              <ChevronRight color={t.chevron} size={17} strokeWidth={2.2} />
            ) : null}
          </Pressable>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ marginTop: 4, fontSize: 13, color: t.faint }}
          >
            Подставляется в новый номер клиента. Номер, введённый со своим
            «+», сохраняется как есть — работать по нескольким странам можно
            без переключения настройки.
          </Text>
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
          <SectionCard title="Реквизиты для счетов">
            {/* Логотип сохраняется СРАЗУ, не дожидаясь «Сохранить»: файл уже
                лежит в хранилище, и держать ссылку в форме — значит потерять
                её при выходе с экрана. */}
            <LogoRow
              logoUrl={tenant?.logo_url ?? null}
              onChange={(url) =>
                update.mutate(
                  { logo_url: url },
                  {
                    onError: (e) => notify("Ошибка", (e as Error).message),
                  },
                )
              }
            />
            <View className="px-4">
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
            {/* Нумерация переехала на свою страницу (Финансы → Настройки →
                Нумерация счетов): там кроме префикса живут ширина номера,
                сброс по годам и «продолжить с номера» при переезде. */}
            </View>
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
