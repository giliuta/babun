import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { LocateFixed, MapPin } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ChoiceRow, FieldRow, RowGroup } from "@/components/ui/card-rows";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { IconCircle } from "@/components/ui/IconCircle";
import { NoticeBar } from "@/components/ui/NoticeBar";
import {
  AddressDetailsFields,
  AddressDetailsToggle,
} from "@/features/clients/AddressPartsFields";
import { composeDetails, hasAddressPlace } from "@/features/clients/object-address";
import { shortDate } from "@/features/clients/location-request-link";
import {
  buildLocationPayload,
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
} from "@/features/clients/location-request-public";
import { MapEmbed } from "@/features/clients/MapEmbed";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// Form of the public «куда приехать мастеру» page (`LocationLinkScreen`).

export function AddressForm({
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
  // Типы — только заведённые командой (владелец 03.10: готового набора
  // нет). Не завела — выбора типа на странице нет вовсе.
  const labels = info.labels;
  const [form, setForm] = useState<LocationForm>({ ...EMPTY_LOCATION_FORM, label: labels[0] ?? "" });
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
          />
        ) : null}
        {labels.length > 0 ? (
          <ChoiceRow
            separated
            options={labels}
            value={form.label}
            onSelect={(v) => setForm((f) => ({ ...f, label: v }))}
          />
        ) : null}
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
