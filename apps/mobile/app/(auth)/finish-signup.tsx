import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import {
  AuthCard,
  AuthField,
  FormError,
  GhostLink,
  InputCard,
  InputDivider,
  NoticeCard,
  PasswordInput,
  PillButton,
} from "@/components/auth/AuthCard";
import { mapAuthError } from "@/components/auth/authErrors";
import { mayFinishHere, signupFinish } from "@/components/auth/signup-finish";
import { useOwnAccountName, useRenameOwnAccount } from "@/features/cabinet/own-account-name";
import { usePendingInvitationToken } from "@/features/settings/invitations";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { signOutAndWipe } from "@/lib/auth-clear";
import { CAN_SIGN_UP_HERE } from "@/lib/pay-here";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

// «ПОЧТИ ГОТОВО» — ПОСЛЕДНИЙ ШАГ ЕДИНОГО ВХОДА (владелец 09.10: «вход через
// Apple, Google… потом должны придумывать пароль»). Сюда гейт входа приводит
// аккаунт, у которого `signupFinish(user).needed`:
//   • вошёл через Apple/Google впервые — имя (уже подставлено) и пароль, чтобы
//     потом входить и почтой;
//   • завёл аккаунт почтой с экрана входа — только имя.
// Имя пишется и человеку (`full_name`), и своему аккаунту — это то, что
// регистрация раньше спрашивала полем «Имя или название компании».
//
// На iPhone новый аккаунт не заводится (`mayFinishHere`, App Review 3.1.1):
// вместо формы — «аккаунта нет» и выход.
export default function FinishSignupScreen() {
  const { session } = useSession();
  const user = session?.user ?? null;
  const finish = signupFinish(user);
  const invitation = usePendingInvitationToken();
  const memberships = useMyMemberships();
  const accountName = useOwnAccountName().data ?? "";
  const rename = useRenameOwnAccount();
  const passwordRef = useRef<TextInput>(null);
  const [name, setName] = useState(finish.suggestedName);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Имя от Apple приходит в метаданные чуть позже сессии — подставляем, пока
  // поле не тронуто.
  useEffect(() => {
    if (finish.suggestedName) setName((current) => current || finish.suggestedName);
  }, [finish.suggestedName]);

  const allowed = mayFinishHere({
    canSignUpHere: CAN_SIGN_UP_HERE,
    hasPendingInvitation: !!invitation.data,
    roles: (memberships.data ?? []).map((m) => m.role),
  });
  const deciding = !CAN_SIGN_UP_HERE && (invitation.isPending || memberships.isPending);

  if (deciding) return <AuthCard>{null}</AuthCard>;

  if (!allowed) {
    return (
      <AuthCard title="Аккаунта нет">
        <NoticeCard>
          {`С адресом ${user?.email ?? ""} аккаунта Babun пока нет. Войдите аккаунтом, который у вас уже есть.`}
        </NoticeCard>
        <PillButton label="Ко входу" onPress={() => void signOutAndWipe()} />
      </AuthCard>
    );
  }

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && (!finish.needsPassword || password.length > 0);

  async function save() {
    if (!valid || saving || !user) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser({
      ...(finish.needsPassword ? { password } : {}),
      data: {
        full_name: trimmed,
        finish_pending: false,
        ...(finish.needsPassword ? { password_set: true } : {}),
      },
    });
    if (e) {
      setSaving(false);
      setError(mapAuthError(e, "reset"));
      return;
    }
    // ИМЯ АККАУНТА — ТО ЖЕ СЛОВО. Сервер назвал аккаунт тем, что знал при
    // создании: почтой или именем из Google. Переименовываем только такой —
    // имя, данное руками на сайте, не трогаем.
    const placeholder = [user.email ?? "", finish.suggestedName, ""].map((v) => v.trim().toLowerCase());
    if (placeholder.includes(accountName.trim().toLowerCase()) && accountName.trim() !== trimmed) {
      await rename.mutateAsync(trimmed).catch(() => undefined);
    }
    setSaving(false);
    // Гейт входа увидит обновлённые метаданные и уведёт в календарь.
  }

  return (
    <AuthCard title="Почти готово">
      <InputCard>
        <AuthField
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          placeholder="Имя или название компании"
          accessibilityLabel="Имя или название компании"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType={finish.needsPassword ? "next" : "done"}
          blurOnSubmit={!finish.needsPassword}
          onSubmitEditing={() => (finish.needsPassword ? passwordRef.current?.focus() : void save())}
        />
        {finish.needsPassword ? (
          <>
            <InputDivider />
            <PasswordInput
              ref={passwordRef}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (error) setError(null);
              }}
              placeholder="Придумайте пароль"
              accessibilityLabel="Придумайте пароль"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
          </>
        ) : null}
      </InputCard>

      <FormError message={error} />

      <PillButton
        label={saving ? "Сохраняем…" : "Готово"}
        onPress={() => void save()}
        disabled={!valid}
        loading={saving}
      />
      <GhostLink label="Выйти" muted onPress={() => void signOutAndWipe()} />
    </AuthCard>
  );
}
