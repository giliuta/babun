import { useState, type ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { CircleCheck } from "lucide-react-native";
import { PublicBusinessHeader } from "@/components/blocks/PublicBusinessHeader";
import { Screen } from "@/components/ui/Screen";
import { Spinner } from "@/components/ui/Spinner";
import { Message } from "@/features/clients/location-link/LinkMessages";
import { useThemeColors } from "@/theme/colors";
import { BookingForm } from "./BookingForm";
import { doneWords, isBookingToken, type BookingDone } from "./online-booking";
import { useBookingPage } from "./online-booking-public";
import { TYPE } from "@/components/ui/tokens";

// «ОНЛАЙН-ЗАПИСЬ» — ПУБЛИЧНАЯ СТРАНИЦА КАЛЕНДАРЯ: babun.app/b/<токен>.
// Ссылку владелец ставит в Instagram, Google-профиль и на визитку
// (шестерёнка календаря → «Онлайн-запись»). Заказчик без входа выбирает
// услугу, время из свободных окон команды и оставляет имя с телефоном;
// запись встаёт в календарь с пометкой «Онлайн-запись».
//
// Страница знает только то, что отдаёт сервер по токену: имя бизнеса,
// календарь, названия и длительности услуг, свободное время. Цен, клиентов
// и чужих записей здесь нет.

export function OnlineBookingScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = isBookingToken(raw) ? raw : null;
  const page = useBookingPage(token);
  const info = page.data;
  const business = info?.businessName ?? "";
  const [done, setDone] = useState<BookingDone | null>(null);

  let body: ReactNode;
  if (!token) {
    body = <Message title="Ссылка не найдена" text="Попросите новую ссылку у того, кто её прислал." />;
  } else if (page.isLoading) {
    body = (
      <View style={{ alignItems: "center", paddingVertical: 80 }}>
        <Spinner size={28} label="Открываем запись" />
      </View>
    );
  } else if (page.isError || !info) {
    body = (
      <Message
        title="Не удалось открыть запись"
        text={page.error instanceof Error ? page.error.message : "Проверьте интернет и повторите."}
        action={{ label: "Повторить", onPress: () => void page.refetch() }}
      />
    );
  } else if (done) {
    body = <Booked done={done} business={business} />;
  } else if (info.state === "missing") {
    body = (
      <Message
        title="Ссылка не найдена"
        text="Попросите новую ссылку у того, кто её прислал."
      />
    );
  } else if (info.state === "closed") {
    body = (
      <Message
        title="Онлайн-запись закрыта"
        text={`Запишитесь по телефону${business ? ` в ${business}` : ""}.`}
      />
    );
  } else {
    body = <BookingForm token={token} info={info} onDone={setDone} />;
  }

  return (
    <Screen edges={["top", "bottom"]}>
      {Platform.OS === "web" ? (
        <Head>
          <title>{`Онлайн-запись${business ? ` · ${business}` : ""}`}</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>
          {info && (info.businessName || info.logoUrl) ? (
            <PublicBusinessHeader name={info.businessName} logoUrl={info.logoUrl} />
          ) : null}
          {body}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Booked({ done, business }: { done: BookingDone; business: string }) {
  const t = useThemeColors();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 24, paddingTop: 48 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${t.success}14`,
        }}
      >
        <CircleCheck color={t.success} size={36} />
      </View>
      <Text
        accessibilityRole="header"
        style={{ marginTop: 18, ...TYPE.title, color: t.ink, textAlign: "center" }}
      >
        Вы записаны
      </Text>
      <Text
        selectable
        style={{ marginTop: 8, fontSize: 16, lineHeight: 22, color: t.body, textAlign: "center" }}
      >
        {[done.service, doneWords(done)].filter(Boolean).join("\n")}
      </Text>
      <Text style={{ marginTop: 14, fontSize: 14, lineHeight: 20, color: t.sub, textAlign: "center" }}>
        {`${business ? `${business} получил заявку.` : "Заявка отправлена."} Страницу можно закрыть.`}
      </Text>
    </View>
  );
}
