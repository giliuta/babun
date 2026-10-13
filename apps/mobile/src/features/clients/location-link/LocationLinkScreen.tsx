import { useState, type ReactNode } from "react";
import { Image, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { Screen } from "@/components/ui/Screen";
import { Spinner } from "@/components/ui/Spinner";
import { isLocationRequestToken } from "@/features/clients/location-request-link";
import type { LookupState } from "@/features/clients/location-request-form";
import { useLocationRequestLookup } from "@/features/clients/location-request-public";
import { useThemeColors } from "@/theme/colors";
import { AddressForm } from "./AddressForm";
import { Done, Message } from "./LinkMessages";

// «КУДА ПРИЕХАТЬ МАСТЕРУ» — страница клиента (STORY-077).
//
// Владелец 2026-09-07: «клиент заходит по ссылке, выбирает свою локацию,
// вносит все свои данные, куда приехать мастеру». Страница — без входа, на
// телефоне из мессенджера, одно действие: отметить, где вы, или написать
// адрес, добавить подъезд · этаж · квартиру и заметку, отправить. Язык
// страницы — язык листа «Новый объект» в приложении (те же строки, тот же
// точный адрес), поэтому объект приезжает в CRM таким, каким его завёл бы
// сам диспетчер. Ссылка одноразовая: после отправки страница благодарит, а
// повторное открытие говорит, что адрес уже получен.

export function LocationLinkScreen() {
  const t = useThemeColors();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = isLocationRequestToken(raw) ? raw : null;
  const lookup = useLocationRequestLookup(token);
  const info = lookup.data;
  const business = info?.businessName ?? "";
  // После отправки сервер сам скажет, что ссылка уже использована или
  // устарела (её могли открыть в двух вкладках) — тогда показываем это,
  // а не форму из устаревшего ответа шапки.
  const [done, setDone] = useState<string | null>(null);
  const [override, setOverride] = useState<Exclude<LookupState, "pending"> | null>(null);

  let body: ReactNode;
  if (!token) {
    body = (
      <Message
        title="Ссылка не найдена"
        text="Попросите новую ссылку у того, кто её прислал."
      />
    );
  } else if (lookup.isLoading) {
    body = (
      <View style={{ alignItems: "center", paddingVertical: 80 }}>
        <Spinner size={28} label="Открываем страницу" />
      </View>
    );
  } else if (lookup.isError || !info) {
    body = (
      <Message
        title="Не удалось открыть страницу"
        text={
          lookup.error instanceof Error
            ? lookup.error.message
            : "Проверьте интернет и повторите."
        }
        action={{ label: "Повторить", onPress: () => void lookup.refetch() }}
      />
    );
  } else if (done !== null) {
    body = <Done business={business} address={done} />;
  } else {
    const state = override ?? info.state;
    if (state === "missing") {
      body = (
        <Message
          title="Ссылка не найдена"
          text={`Попросите новую ссылку${business ? ` у ${business}` : ""}.`}
        />
      );
    } else if (state === "used") {
      body = (
        <Message
          title="Адрес уже отправлен"
          text={`${business || "Мастер"} получил ваш адрес. Если что-то изменилось — напишите или позвоните.`}
        />
      );
    } else if (state === "expired") {
      body = (
        <Message
          title="Ссылка устарела"
          text={`Ссылка действовала 7 дней. Попросите новую${business ? ` у ${business}` : ""}.`}
        />
      );
    } else {
      body = (
        <AddressForm
          token={token}
          info={info}
          onDone={setDone}
          onState={setOverride}
        />
      );
    }
  }

  return (
    <Screen edges={["top", "bottom"]}>
      {Platform.OS === "web" ? (
        <Head>
          <title>{`Адрес для мастера${business ? ` · ${business}` : ""}`}</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* На большом экране страница — узкая колонка посередине: строки
            формы рассчитаны на ширину телефона. */}
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>
          {info && (info.businessName || info.logoUrl) ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              {info.logoUrl ? (
                <Image
                  source={{ uri: info.logoUrl }}
                  accessibilityIgnoresInvertColors
                  style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: t.fill }}
                />
              ) : (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${t.accent}14`,
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: "700", color: t.accent }}>
                    {info.businessName.trim().charAt(0).toUpperCase() || "•"}
                  </Text>
                </View>
              )}
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 17, fontWeight: "700", color: t.ink }}
              >
                {info.businessName}
              </Text>
            </View>
          ) : null}
          {body}
        </View>
      </ScrollView>
    </Screen>
  );
}
