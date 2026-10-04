import { useState } from "react";
import { Pressable, Text } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { saveUiLocale, uiLocale } from "@babun/shared/i18n/locale";
import { localeInfo } from "@babun/shared/i18n/locales";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { LanguageOptionList } from "@/components/ui/LanguageOptionList";
import { useAuthTheme } from "@/components/auth/theme";
import { reloadApp } from "@/features/cabinet/reload-app";

// ЯЗЫК — ДО ВХОДА (владелец 04.10: «не все говорят на русском… как он зайдёт,
// увидит русский — как он зарегистрируется»). Кнопка в углу экранов входа,
// регистрации и сброса пароля: флаг и имя языка его же словами, чтобы человек
// нашёл свой, не читая текущего. Тап — та же шторка, что в Кабинете →
// «Языки»; выбор перезапускает приложение уже на новом языке.
export function AuthLanguageButton() {
  const t = useAuthTheme();
  const [open, setOpen] = useState(false);
  const current = localeInfo(uiLocale());

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Язык: ${current.name}`}
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          minHeight: 36,
          paddingHorizontal: 12,
          borderRadius: 18,
          backgroundColor: t.surface,
          boxShadow: t.cardShadow,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontSize: 16 }}>{current.flag}</Text>
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {current.name}
        </Text>
        <ChevronDown color={t.sub} size={16} strokeWidth={2.2} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Язык" scroll padded={false} maxHeightRatio={0.75}>
        <LanguageOptionList
          selected={current.code}
          onPick={(code) => {
            setOpen(false);
            if (code !== current.code && saveUiLocale(code)) reloadApp();
          }}
        />
      </BottomSheet>
    </>
  );
}
