import { View } from "react-native";
import { Spinner } from "@/components/ui/Spinner";
import {
  AuthCard,
  GhostLink,
  NoticeCard,
  PillButton,
} from "@/components/auth/AuthCard";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useOnboardingGate, useRetryOnboardingGate } from "@/lib/tenant";

// Аккаунт вошёл, а его данные не открылись: строки аккаунта нет или сеть не
// дала её проверить. Мастера настройки здесь больше нет (владелец 04.10:
// «как называется ваш бизнес… чем вы занимаетесь… — убираем»): аккаунт
// готов к работе с регистрации, этот экран — только запасной выход.
export default function AccountMissingScreen() {
  const gate = useOnboardingGate();

  if (gate.status === "no-tenant") {
    return (
      <GateErrorCard
        title="Аккаунт не настроен"
        body="Мы не нашли данные этого аккаунта. Попробуйте ещё раз или войдите с другим аккаунтом."
      />
    );
  }
  if (gate.status === "unknown") {
    return (
      <GateErrorCard
        title="Не удалось загрузить аккаунт"
        body="Похоже, что-то с подключением. Попробуйте ещё раз — обычно помогает."
      />
    );
  }

  // "loading" — ждём гейт; "onboarded"/"signed-out" — гейт входа сейчас
  // уведёт с этого экрана, показываем спиннер, чтобы не мигать.
  return (
    <AuthCard>
      <View style={{ paddingVertical: 32, alignItems: "center" }}>
        <Spinner size={26} label="Загрузка" />
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
