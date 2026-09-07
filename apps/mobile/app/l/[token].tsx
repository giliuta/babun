import { useMemo, useState, type ReactNode } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { CircleCheck, LocateFixed, MapPin } from "lucide-react-native";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import { Button } from "@/components/ui/Button";
import { ChoiceRow, FieldRow, RowGroup } from "@/components/ui/card-rows";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { IconCircle } from "@/components/ui/IconCircle";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import {
  AddressDetailsFields,
  AddressDetailsToggle,
} from "@/features/clients/AddressPartsFields";
import { composeDetails, hasAddressPlace } from "@/features/clients/object-address";
import {
  isLocationRequestToken,
  shortDate,
} from "@/features/clients/location-request-link";
import {
  buildLocationPayload,
  DEFAULT_LOCATION_LABELS,
  EMPTY_LOCATION_FORM,
  formatCoords,
  locationFormReady,
  type LocationForm,
  type LocationRequestLookup,
  type LookupState,
} from "@/features/clients/location-request-form";
import {
  canLocate,
  locateMe,
  reverseGeocode,
  submitLocationRequest,
  useLocationRequestLookup,
} from "@/features/clients/location-request-public";
import { MapEmbed } from "@/features/clients/MapEmbed";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

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

export default function LocationLinkScreen() {
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

// ─── Форма ───────────────────────────────────────────────────────────────────

function AddressForm({
  token,
  info,
  onDone,
  onState,
}: {
  token: string;
  info: LocationRequestLookup;
  onDone: (address: string) => void;
  onState: (state: Exclude<LookupState, "pending">) => void;
}) {
  const t = useThemeColors();
  const labels = info.labels.length > 0 ? info.labels : [...DEFAULT_LOCATION_LABELS];
  const [form, setForm] = useState<LocationForm>({ ...EMPTY_LOCATION_FORM, label: labels[0] });
  // Точный адрес ОТКРЫТ сразу: подъезд, этаж и квартира — то, ради чего
  // ссылку и отправили; спрятанные за строкой их пропустили бы.
  const [partsOpen, setPartsOpen] = useState(true);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = locationFormReady(form);
  const until = useMemo(
    () => (info.expiresAt ? shortDate(info.expiresAt) : ""),
    [info.expiresAt],
  );
  const name = info.clientFirstName.trim();
  const showLocate = canLocate();

  const locate = async () => {
    if (locating) return;
    setLocateError(null);
    setLocating(true);
    try {
      const coords = await locateMe();
      setForm((f) => ({ ...f, coords }));
      haptics.success();
      // Улица и город — подарком от геокодера, но только в пустые поля:
      // набранное клиентом главнее угаданного.
      const found = await reverseGeocode(coords);
      setForm((f) => {
        if (f.line.trim() || hasAddressPlace(f.parts)) return f;
        return {
          ...f,
          line: found.street ?? "",
          parts: {
            ...f.parts,
            city: f.parts.city || found.city,
            zip: f.parts.zip || found.zip,
          },
        };
      });
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : "Не удалось определить место.");
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!ready || sending) return;
    setError(null);
    setSending(true);
    try {
      const result = await submitLocationRequest(token, buildLocationPayload(form));
      if (result.ok) {
        haptics.success();
        onDone(result.address);
      } else {
        onState(result.state);
      }
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Не удалось отправить. Повторите.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.4, color: t.ink }}
        >
          {name ? `${name}, куда приехать мастеру?` : "Куда приехать мастеру?"}
        </Text>
        <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 21, color: t.sub }}>
          Отметьте точку или напишите адрес — это минута.
        </Text>
      </View>

      <RowGroup>
        {showLocate ? (
          form.coords ? (
            <>
              <View style={{ padding: 12, paddingBottom: 0 }}>
                <MapEmbed coords={form.coords} />
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingLeft: 16,
                  paddingRight: 12,
                  minHeight: 56,
                }}
              >
                <IconCircle icon={MapPin} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                    Точка отмечена
                  </Text>
                  <Text style={{ fontSize: 13, color: t.sub }}>{formatCoords(form.coords)}</Text>
                </View>
                <Pressable
                  onPress={() => setForm((f) => ({ ...f, coords: null }))}
                  accessibilityRole="button"
                  accessibilityLabel="Убрать точку"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
                >
                  <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>Убрать</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <ChooseRow
              icon={LocateFixed}
              label={locating ? "Определяем место…" : "Я сейчас здесь"}
              hint="Отмечает на карте ваше местоположение"
              onPress={() => void locate()}
            />
          )
        ) : null}
        {locateError ? <NoticeBar tone="warn" message={locateError} /> : null}
        <FieldRow
          label="Адрес"
          hideLabel
          big
          value={form.line}
          placeholder="Улица и дом или ссылка на карту"
          stacked
          multiline
          live
          separated={showLocate}
          onSave={(v) => setForm((f) => ({ ...f, line: v }))}
        />
        <AddressDetailsToggle
          open={partsOpen}
          summary={composeDetails(form.parts)}
          onToggle={() => setPartsOpen((open) => !open)}
        />
        {partsOpen ? (
          <AddressDetailsFields
            parts={form.parts}
            onChange={(parts) => setForm((f) => ({ ...f, parts }))}
            pin={form.pin}
            onPinChange={(pin) => setForm((f) => ({ ...f, pin }))}
            showPin={!form.coords && !isLikelyUrl(form.line.trim())}
          />
        ) : null}
        <ChoiceRow
          separated
          options={labels}
          value={form.label}
          onSelect={(v) => setForm((f) => ({ ...f, label: v }))}
        />
      </RowGroup>

      <RowGroup title="Заметка">
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <TextInput
            value={form.note}
            onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
            multiline
            accessibilityLabel="Заметка для мастера"
            placeholder="Как войти, код, кто встречает…"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            maxFontSizeMultiplier={1.2}
            style={{
              minHeight: 44,
              maxHeight: 120,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: t.radius.input,
              backgroundColor: t.fill,
              fontSize: 15,
              color: t.ink,
            }}
          />
        </View>
      </RowGroup>

      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        {error ? (
          <View style={{ marginBottom: 12 }}>
            <NoticeBar tone="error" message={error} />
          </View>
        ) : null}
        <Button
          label={sending ? "Отправляем…" : "Отправить адрес"}
          onPress={() => void submit()}
          disabled={!ready || sending}
          loading={sending}
        />
        <Text style={{ marginTop: 12, textAlign: "center", fontSize: 12, color: t.faint }}>
          {until ? `Ссылка одноразовая · действует до ${until}` : "Ссылка одноразовая"}
        </Text>
      </View>
    </>
  );
}

// ─── Итог и сообщения ────────────────────────────────────────────────────────

function Done({ business, address }: { business: string; address: string }) {
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
        style={{ marginTop: 18, fontSize: 24, fontWeight: "800", color: t.ink, textAlign: "center" }}
      >
        Адрес отправлен
      </Text>
      {address ? (
        <Text
          selectable
          style={{ marginTop: 8, fontSize: 15, lineHeight: 21, color: t.body, textAlign: "center" }}
        >
          {address}
        </Text>
      ) : null}
      <Text style={{ marginTop: 14, fontSize: 14, lineHeight: 20, color: t.sub, textAlign: "center" }}>
        {business ? `${business} получил адрес.` : "Мастер получил адрес."} Страницу можно закрыть.
      </Text>
    </View>
  );
}

function Message({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useThemeColors();
  return (
    <SectionCard padded className="mt-4">
      <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>{title}</Text>
      <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 20, color: t.sub }}>{text}</Text>
      {action ? (
        <View className="mt-4">
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </SectionCard>
  );
}
