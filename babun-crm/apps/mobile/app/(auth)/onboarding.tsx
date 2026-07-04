import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  InputDivider,
  NoticeCard,
  PillButton,
} from "@/components/auth/AuthCard";
import { useAuthTheme } from "@/components/auth/theme";
import { signOutAndWipe } from "@/lib/auth-clear";
import {
  useCompleteOnboarding,
  useOnboardingGate,
  useRetryOnboardingGate,
  type OnboardingTenant,
} from "@/lib/tenant";

// «Первый запуск» — мобильная версия веб-мастера онбординга
// (apps/web/src/components/onboarding/OnboardingWizard.tsx, STORY-040):
// 3 шага — название бизнеса → вертикаль → готово (summary + чек-лист).
// Копия шагов и текстов 1:1 с вебом; оболочка — auth-примитивы Halo Cobalt.

type Vertical = "hvac" | "beauty" | "auto" | "cleaning" | "other";

const KNOWN_VERTICALS: readonly Vertical[] = [
  "hvac",
  "beauty",
  "auto",
  "cleaning",
  "other",
];

const VERTICAL_OPTIONS: readonly { value: Vertical; emoji: string; label: string }[] = [
  { value: "hvac", emoji: "🌬️", label: "Кондиционеры" },
  { value: "beauty", emoji: "💅", label: "Красота и здоровье" },
  { value: "auto", emoji: "🚗", label: "Авто-сервис" },
  { value: "cleaning", emoji: "🧹", label: "Клининг" },
  { value: "other", emoji: "🛠️", label: "Другое" },
];

const VERTICAL_LABELS: Record<Vertical, string> = {
  hvac: "Кондиционеры",
  beauty: "Красота и здоровье",
  auto: "Авто-сервис",
  cleaning: "Клининг",
  other: "Другое",
};

// Пассивный чек-лист «что сделать дальше» (веб StepDone, team-вариант).
// Navigation paths adapted to the mobile app (Кабинет sections), not web pages.
const TEAM_CHECKLIST: readonly { emoji: string; title: string; body: string }[] = [
  {
    emoji: "👥",
    title: "Соберите команду",
    body: "Кабинет → «Мастера» — добавьте сотрудников. Свяжите их с командами в разделе Кабинет → «Команды».",
  },
  {
    emoji: "🧰",
    title: "Заведите услуги",
    body: "Кабинет → «Услуги» — задайте цену, длительность, цвет. Они автоматически подставятся в новые записи.",
  },
  {
    emoji: "📞",
    title: "Создайте первую запись клиента",
    body: "Нажмите ячейку в календаре, выберите клиента и услугу — запись появится в расписании.",
  },
  {
    emoji: "📲",
    title: "Подключите SMS-уведомления",
    body: "Кабинет → SMS-шаблоны — готовые тексты напоминаний и подтверждений для клиентов.",
  },
];

export default function OnboardingScreen() {
  const gate = useOnboardingGate();

  if (gate.status === "needs-onboarding") {
    // key: если активный tenant сменится (другой аккаунт), мастер стартует заново.
    return <Wizard key={gate.tenantId} tenantId={gate.tenantId} tenant={gate.tenant} />;
  }
  if (gate.status === "no-tenant") {
    return (
      <GateErrorCard
        title="Аккаунт не настроен"
        body="Мы не нашли бизнес, привязанный к этому аккаунту. Попробуйте ещё раз или войдите с другим аккаунтом."
      />
    );
  }
  if (gate.status === "unknown") {
    // Веб-паритет: TransientLoadError в onboarding/page.tsx (STORY-079).
    return (
      <GateErrorCard
        title="Не удалось загрузить аккаунт"
        body="Похоже, что-то с подключением. Попробуйте ещё раз — обычно помогает."
      />
    );
  }

  // "loading" — ждём гейт; "onboarded"/"signed-out" — корневой навигатор
  // сейчас уведёт с этого экрана, показываем спиннер, чтобы не мигать.
  return <PendingCard />;
}

// ---------------------------------------------------------------------------

function PendingCard() {
  const t = useAuthTheme();
  return (
    <AuthCard>
      <View accessibilityLabel="Загрузка" style={{ paddingVertical: 32, alignItems: "center" }}>
        <ActivityIndicator color={t.accent} />
      </View>
    </AuthCard>
  );
}

function GateErrorCard({ title, body }: { title: string; body: string }) {
  const retry = useRetryOnboardingGate();
  return (
    <AuthCard title={title}>
      <NoticeCard>{body}</NoticeCard>
      <PillButton label="Повторить" onPress={retry} />
      <GhostLink label="Выйти" muted onPress={() => void signOutAndWipe()} />
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------

function Wizard({
  tenantId,
  tenant,
}: {
  tenantId: string;
  tenant: OnboardingTenant;
}) {
  const router = useRouter();
  const complete = useCompleteOnboarding();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Префилл как на вебе (A6): имя из триггера может быть email — тогда пусто.
  const [name, setName] = useState(
    tenant.name && !tenant.name.includes("@") ? tenant.name : "",
  );
  const [vertical, setVertical] = useState<Vertical | null>(
    tenant.vertical && (KNOWN_VERTICALS as readonly string[]).includes(tenant.vertical)
      ? (tenant.vertical as Vertical)
      : null,
  );
  const [error, setError] = useState<string | null>(null);

  const commit = (next: "team" | "calendar") => {
    if (complete.isPending || !name.trim() || !vertical) return;
    setError(null);
    complete.mutate(
      { tenantId, name, vertical },
      {
        onSuccess: () => {
          // Инвалидация tenant-состояния уже в onSuccess мутации — входим в
          // dashboard без перезапуска приложения.
          router.replace(next === "team" ? "/cabinet/teams" : "/");
        },
        onError: (e) =>
          setError(
            e instanceof Error && e.message
              ? e.message
              : "Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.",
          ),
      },
    );
  };

  return (
    <AuthCard>
      <ProgressBar step={step} totalSteps={3} />
      {step === 1 && (
        <StepBusinessName
          value={name}
          onChange={setName}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <StepVertical
          value={vertical}
          onChange={setVertical}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <StepDone
          name={name}
          vertical={vertical}
          saving={complete.isPending}
          error={error}
          onBack={() => setStep(2)}
          onCommit={commit}
        />
      )}
    </AuthCard>
  );
}

function ProgressBar({ step, totalSteps }: { step: number; totalSteps: number }) {
  const t = useAuthTheme();
  return (
    <View
      accessibilityLabel={`Шаг ${step} из ${totalSteps}`}
      style={{ flexDirection: "row", gap: 6, marginBottom: 20, paddingHorizontal: 4 }}
    >
      {Array.from({ length: totalSteps }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 999,
            backgroundColor: i + 1 <= step ? t.accent : t.disabledFill,
          }}
        />
      ))}
    </View>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const t = useAuthTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 20, lineHeight: 26, fontWeight: "700", color: t.ink }}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}
      >
        {subtitle}
      </Text>
    </View>
  );
}

// Шаг 1 — название бизнеса (веб StepBusinessName).
function StepBusinessName({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const ready = value.trim().length >= 2;
  return (
    <View>
      <StepHeading
        title="Как называется ваш бизнес?"
        subtitle="Можно поменять позже в настройках."
      />
      <InputCard>
        <AuthField
          autoFocus
          value={value}
          onChangeText={onChange}
          placeholder="Название компании"
          accessibilityLabel="Название компании"
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={() => ready && onNext()}
        />
      </InputCard>
      <PillButton label="Далее" onPress={onNext} disabled={!ready} />
    </View>
  );
}

// Шаг 2 — вертикаль (веб StepVertical).
function StepVertical({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: Vertical | null;
  onChange: (v: Vertical) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useAuthTheme();
  return (
    <View>
      <StepHeading
        title="Чем вы занимаетесь?"
        subtitle="Выберите ближайшее. Это помогает подобрать дефолты."
      />
      <InputCard>
        {VERTICAL_OPTIONS.map((opt, i) => {
          const selected = value === opt.value;
          return (
            <View key={opt.value}>
              {i > 0 ? <InputDivider /> : null}
              <Pressable
                onPress={() => onChange(opt.value)}
                accessibilityRole="radio"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <Text style={{ fontSize: 20 }} accessibilityElementsHidden>
                  {opt.emoji}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{
                    flex: 1,
                    fontSize: 15,
                    fontWeight: "500",
                    color: t.ink,
                  }}
                >
                  {opt.label}
                </Text>
                {selected ? <Check color={t.accent} size={20} /> : null}
              </Pressable>
            </View>
          );
        })}
      </InputCard>
      <PillButton label="Далее" onPress={onNext} disabled={value === null} />
      <GhostLink label="← Назад" muted onPress={onBack} />
    </View>
  );
}

// Шаг 3 — «Всё готово!» (веб StepDone): summary, чек-лист, два CTA.
function StepDone({
  name,
  vertical,
  saving,
  error,
  onBack,
  onCommit,
}: {
  name: string;
  vertical: Vertical | null;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onCommit: (next: "team" | "calendar") => void;
}) {
  const t = useAuthTheme();
  return (
    <View>
      <StepHeading
        title="Всё готово!"
        subtitle="Babun настроен. Дальше — открыть календарь или сразу собирать команду."
      />

      <InputCard>
        <SummaryRow label="Бизнес" value={name || "—"} />
        <InputDivider />
        <SummaryRow label="Тип" value={vertical ? VERTICAL_LABELS[vertical] : "—"} />
      </InputCard>

      <Text
        maxFontSizeMultiplier={1.3}
        style={{
          marginTop: 20,
          marginBottom: 8,
          marginLeft: 4,
          fontSize: 12,
          fontWeight: "600",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: t.sub,
        }}
      >
        Что сделать дальше
      </Text>
      <InputCard>
        {TEAM_CHECKLIST.map((item, i) => (
          <View key={item.title}>
            {i > 0 ? <InputDivider /> : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <Text style={{ fontSize: 20, marginTop: 2 }} accessibilityElementsHidden>
                {item.emoji}
              </Text>
              <View style={{ flex: 1 }}>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{ fontSize: 14, lineHeight: 19, fontWeight: "600", color: t.ink }}
                >
                  {item.title}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{ marginTop: 2, fontSize: 12, lineHeight: 17, color: t.sub }}
                >
                  {item.body}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </InputCard>

      <FormError message={error} />

      {/* Веб-паритет: primary «Создать команду», secondary «календарь». */}
      <PillButton
        label={saving ? "Сохраняем…" : "Создать команду"}
        onPress={() => onCommit("team")}
        disabled={saving}
        loading={saving}
      />
      <SecondaryPill
        label="Сначала посмотреть календарь"
        onPress={() => onCommit("calendar")}
        disabled={saving}
      />
      <GhostLink label="← Назад" muted onPress={onBack} />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const t = useAuthTheme();
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ width: 80, fontSize: 13, color: t.sub }}
      >
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ flex: 1, fontSize: 14, fontWeight: "500", color: t.ink }}
      >
        {value}
      </Text>
    </View>
  );
}

// Вторичный full-width pill (веб: surface + border + accent text).
function SecondaryPill({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useAuthTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        marginTop: 10,
        minHeight: 52,
        paddingVertical: 14,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.pressed : t.surface,
        borderWidth: 1,
        borderColor: t.separator,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 17,
          fontWeight: "600",
          color: disabled ? t.sub : t.accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
