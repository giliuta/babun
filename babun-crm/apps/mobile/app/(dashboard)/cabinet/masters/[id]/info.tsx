import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Lock } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useMaster, useUpdateMaster } from "@/features/reference/queries";
import {
  getMasterProfile,
  useUpdateMasterProfile,
  type MasterProfile,
} from "@/features/reference/master-profile";

// Инфо мастера (мега-скролл, порт web masters/[id]/info/page.tsx). Одна
// длинная простыня, сгруппированная по iOS-секциям. Мгновенный commit по
// blur (как на вебе): плоские поля (имя/телефон/должность) пишутся в колонки
// masters через useUpdateMaster; богатые (день рождения, наём, мессенджеры,
// адрес, банк) — в profile jsonb через useUpdateMasterProfile (merge, без
// затирания незнакомых ключей). Аккаунт-логин и Документы — read-only «скоро»
// (BLOCKED-5: Supabase Auth admin / Storage не трогаем).

export default function MasterInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useThemeColors();
  const { data: master, isLoading } = useMaster(id);
  const updateMaster = useUpdateMaster();
  const updateProfile = useUpdateMasterProfile();

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Информация" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (!master) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Информация" />
        <EmptyState fill title="Мастер не найден" />
      </Screen>
    );
  }

  const profile = getMasterProfile(master);

  // Плоская колонка masters — commit только при реальном изменении.
  const commitColumn = (field: "full_name" | "phone" | "title", next: string) => {
    const trimmed = next.trim();
    const current = ((master[field] as string | null) ?? "").trim();
    if (trimmed === current) return;
    // full_name — обязателен, пустым в колонку не пишем.
    const value = field === "full_name" ? trimmed || master.full_name : trimmed || null;
    updateMaster.mutate(
      { id: master.id, patch: { [field]: value } },
      { onError: (e) => alertErr(e) },
    );
  };

  // Богатое поле в profile jsonb — patch с merge (read-before-write внутри
  // хука защищает от гонки быстрых правок).
  const commitProfile = (field: keyof MasterProfile, next: string) => {
    const trimmed = next.trim();
    const current = ((profile[field] as string | undefined) ?? "").trim();
    if (trimmed === current) return;
    updateProfile.mutate(
      { id: master.id, patch: { [field]: trimmed || undefined } as MasterProfile },
      { onError: (e) => alertErr(e) },
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Информация" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Section title="Основное">
            <CommitField
              label="Имя"
              initial={master.full_name}
              placeholder="Иван Петров"
              onCommit={(v) => commitColumn("full_name", v)}
            />
            <CommitField
              label="Должность"
              initial={master.title ?? ""}
              placeholder="Старший техник"
              onCommit={(v) => commitColumn("title", v)}
            />
            <CommitField
              label="День рождения"
              initial={profile.birthday ?? ""}
              placeholder="ГГГГ-ММ-ДД"
              onCommit={(v) => commitProfile("birthday", v)}
            />
            <CommitField
              label="Дата найма"
              initial={profile.hire_date ?? ""}
              placeholder="ГГГГ-ММ-ДД"
              onCommit={(v) => commitProfile("hire_date", v)}
            />
          </Section>

          <Section title="Контакты">
            <CommitField
              label="Телефон"
              initial={master.phone ?? ""}
              placeholder="+357…"
              keyboardType="phone-pad"
              onCommit={(v) => commitColumn("phone", v)}
            />
            <CommitField
              label="WhatsApp"
              initial={profile.whatsapp ?? ""}
              placeholder="+357…"
              keyboardType="phone-pad"
              onCommit={(v) => commitProfile("whatsapp", v)}
            />
            <CommitField
              label="Telegram"
              initial={profile.telegram ?? ""}
              placeholder="@username"
              autoCapitalize="none"
              onCommit={(v) => commitProfile("telegram", v)}
            />
            <CommitField
              label="Email"
              initial={profile.email ?? ""}
              placeholder="master@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              onCommit={(v) => commitProfile("email", v)}
            />
            <CommitField
              label="Адрес"
              initial={profile.address ?? ""}
              placeholder="Пафос, ул. Posidonos 12"
              onCommit={(v) => commitProfile("address", v)}
            />
          </Section>

          <Section title="Банк">
            <CommitField
              label="IBAN"
              initial={profile.iban ?? ""}
              placeholder="CY00 0000 0000 …"
              autoCapitalize="characters"
              onCommit={(v) => commitProfile("iban", v)}
            />
            <CommitField
              label="Банк"
              initial={profile.bank_name ?? ""}
              placeholder="Bank of Cyprus"
              onCommit={(v) => commitProfile("bank_name", v)}
            />
            <CommitField
              label="Налоговый номер"
              initial={profile.tax_number ?? ""}
              placeholder="TIN / АФМ"
              onCommit={(v) => commitProfile("tax_number", v)}
            />
          </Section>

          {/* BLOCKED-5: аккаунт-логин (пароль) и документы требуют Supabase
              Auth admin / Storage — пока read-only плашка «скоро». */}
          <View className="mx-3 mt-4">
            <Card>
              <View className="flex-row items-center gap-3 px-4 py-4">
                <Lock color={t.faint} size={ICON.sm} />
                <View className="flex-1">
                  <Text style={{ fontSize: 15, color: t.ink }}>
                    Аккаунт и документы
                  </Text>
                  <Text style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>
                    Логин, пароль и файлы — скоро.
                  </Text>
                </View>
              </View>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function alertErr(e: unknown) {
  Alert.alert("Ошибка", (e as Error).message);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useThemeColors();
  return (
    <View className="mx-3 mt-4">
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: t.faint,
          marginBottom: 6,
          marginLeft: 4,
        }}
      >
        {title}
      </Text>
      <Card>
        <View className="px-4 pt-4">{children}</View>
      </Card>
    </View>
  );
}

// Uncontrolled-ish field: seeds from `initial`, keeps its own draft, commits
// on blur (mirrors the web instant-commit-on-blur behaviour). Uniform Field
// spacing — the trailing 16px sits inside the card's `pt-4`, reading as even
// grouped-iOS padding.
function CommitField({
  label,
  initial,
  placeholder,
  keyboardType,
  autoCapitalize,
  onCommit,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Field
      label={label}
      value={value}
      onChangeText={setValue}
      onBlur={() => onCommit(value)}
      placeholder={placeholder}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
    />
  );
}
