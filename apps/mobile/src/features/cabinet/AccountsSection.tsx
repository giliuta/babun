import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ScopeChips, type ScopeChip } from "@/components/ui/ScopeChips";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { useMyAccounts, type MyAccount } from "@/features/settings/my-accounts";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";

import { CreateCompanySheet } from "./CreateCompanySheet";
import { InvitedAccounts, MemberAccountSection } from "./InvitedAccounts";
import { OwnAccountSection } from "./OwnAccountSection";

// ЛИЧНОЕ И КОМПАНИИ В КАБИНЕТЕ (владелец 11.10: «Кабинет: переключатель
// Личное │ компании и создать компанию»). Сверху — та же лента, что над
// календарём: «Личное», черта, компании; справа текстом «Создать» (канон:
// действие создания подписано словом). Под лентой — блок ВЫБРАННОГО
// аккаунта: свой — его хозяйство (`OwnAccountSection`), чужой — то, что
// открыл владелец, и «Покинуть компанию» (`MemberAccountSection`).
//
// Выбор ленты — только этого экрана: телефон в аккаунт не переходит, пока
// человек не откроет страницу, которой нужен открытый аккаунт. По умолчанию
// выбран тот, что открыт на телефоне.

export function AccountsSection() {
  const t = useThemeColors();
  const mirror = useMirror();
  const accounts = useMyAccounts().data ?? [];
  const activeTenant = useTenantId();
  const [picked, setPicked] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // «Посмотреть его глазами»: у партнёра этот аккаунт — пригласивший, и блок
  // стоит ровно так, как у него.
  if (mirror) return <InvitedAccounts />;
  if (accounts.length === 0) return null;

  const selected: MyAccount =
    accounts.find((a) => a.tenantId === picked) ??
    accounts.find((a) => a.tenantId === activeTenant) ??
    accounts[0]!;

  const items: ScopeChip[] = accounts.map((a) => ({
    id: a.tenantId,
    name: a.kind === "personal" ? "Личное" : a.name,
    group: a.kind,
  }));
  const ownsCompany = accounts.some((a) => a.kind === "company" && a.role === "owner");

  return (
    <View style={{ marginTop: 16 }}>
      <ScopeChips
        items={items}
        activeId={selected.tenantId}
        onCanvas
        seam={false}
        onSelect={setPicked}
        trailing={
          <Pressable
            onPress={() => setCreateOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Создать компанию"
            style={({ pressed }: { pressed: boolean }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
              Создать
            </Text>
          </Pressable>
        }
      />
      {selected.role === "owner" ? (
        <OwnAccountSection tenantId={selected.tenantId} kind={selected.kind} />
      ) : (
        <MemberAccountSection tenantId={selected.tenantId} name={selected.name} />
      )}
      <CreateCompanySheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(tenantId) => setPicked(tenantId)}
        firstCompany={!ownsCompany}
      />
    </View>
  );
}
