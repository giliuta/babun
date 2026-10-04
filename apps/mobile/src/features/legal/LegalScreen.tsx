import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Head from "expo-router/head";
import { uiLocale } from "@babun/shared/i18n/locale";

import { BrandLockup } from "@/components/brand/BrandMark";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { GUTTER, TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

import { fillLegal, LEGAL_SHORT, LEGAL_TEXTS, legalLang, parseLegal, type LegalDocId } from "./legal-texts";
import { LEGAL_OPERATOR, legalEmail } from "./operator";

// ДОКУМЕНТ — ПОЛИТИКА, УСЛОВИЯ, УДАЛЕНИЕ АККАУНТА (04.10, выпуск в магазины).
//
// Открывается без входа (babun.app/privacy и т. д. — ссылки из карточек App
// Store и Google Play, с экрана регистрации и из «Помощи»). Шапка — короткое
// имя документа и переключатель языка; ниже — полное название и текст колонкой не шире 720, чтобы на
// компьютере строки не растягивались на весь экран. Язык — `?lang=ru|en`,
// без него — язык интерфейса (русский или английский для всех остальных).

const READ_WIDTH = 720;

export function LegalScreen({ doc }: { doc: LegalDocId }) {
  const t = useThemeColors();
  const router = useRouter();
  const { lang: param } = useLocalSearchParams<{ lang?: string }>();
  const lang = legalLang(param, uiLocale());
  const blocks = useMemo(
    () =>
      parseLegal(
        fillLegal(LEGAL_TEXTS[doc][lang], { ...LEGAL_OPERATOR, email: legalEmail() }),
      ),
    [doc, lang],
  );
  const title = blocks.find((b) => b.kind === "title")?.text ?? "Babun";
  const other = lang === "ru" ? "en" : "ru";

  return (
    <Screen edges={["top"]}>
      <Head>
        <title>{`${title} · Babun`}</title>
      </Head>
      <ScreenHeader
        title={LEGAL_SHORT[doc][lang]}
        right={
          <Pressable
            onPress={() => router.setParams({ lang: other })}
            className="h-11 items-center justify-center px-3 active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel={other === "en" ? "English" : /* i18n-ignore */ "Русский"}
          >
            <Text style={{ ...TYPE.callout, color: t.accent }}>
              {other === "en" ? "English" : /* i18n-ignore */ "Русский"}
            </Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 40 }}>
        <View style={{ width: "100%", maxWidth: READ_WIDTH, alignSelf: "center" }}>
          <View style={{ alignItems: "flex-start", paddingTop: 8, paddingBottom: 12 }}>
            <BrandLockup size={32} />
          </View>
          {blocks.map((block, index) => {
            switch (block.kind) {
              case "title":
                return (
                  <Text
                    key={index}
                    accessibilityRole="header"
                    maxFontSizeMultiplier={1.3}
                    style={{ ...TYPE.title, color: t.ink, marginTop: 8, marginBottom: 4 }}
                  >
                    {block.text}
                  </Text>
                );
              case "heading":
                return (
                  <Text
                    key={index}
                    accessibilityRole="header"
                    maxFontSizeMultiplier={1.3}
                    style={{ ...TYPE.headline, color: t.ink, marginTop: 24, marginBottom: 8 }}
                  >
                    {block.text}
                  </Text>
                );
              case "item":
                return (
                  <View key={index} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                    {/^\d+\./.test(block.text) ? null : (
                      <Text style={{ ...TYPE.body, color: t.sub }}>•</Text>
                    )}
                    <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.body, color: t.ink, flex: 1 }}>
                      {block.text}
                    </Text>
                  </View>
                );
              case "paragraph": {
                // Строка сразу под названием — дата правки, тише текста.
                const dated = index === 1 && blocks[0]?.kind === "title";
                return (
                  <Text
                    key={index}
                    maxFontSizeMultiplier={1.3}
                    style={
                      dated
                        ? { ...TYPE.subhead, color: t.faint, marginBottom: 12 }
                        : { ...TYPE.body, color: t.ink, marginBottom: 10 }
                    }
                  >
                    {block.text}
                  </Text>
                );
              }
            }
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default LegalScreen;
