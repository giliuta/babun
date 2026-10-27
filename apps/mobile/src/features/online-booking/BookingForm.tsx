import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { FieldRow, RowGroup, RowGroupHeader } from "@/components/ui/card-rows";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { Spinner } from "@/components/ui/Spinner";
import { haptics } from "@/lib/haptics";
import { dialPrefix, normalizeCountry, tryToE164 } from "@/lib/phone";
import { sanitizePhoneInput } from "@/lib/phone-input";
import { useThemeColors } from "@/theme/colors";
import { BookingSlotPicker } from "./BookingSlotPicker";
import { durationWords, type BookingDone, type BookingPage } from "./online-booking";
import { BookingError, createBooking, useBookingSlots } from "./online-booking-public";

// ФОРМА ПУБЛИЧНОЙ ЗАПИСИ (`OnlineBookingScreen`): услуга → время → имя и
// телефон → «Записаться». Шаги видны сразу один под другим: следующий
// появляется, как только выбран предыдущий, — без кнопок «Далее».

export function BookingForm({
  token,
  info,
  onDone,
}: {
  token: string;
  info: BookingPage;
  onDone: (done: BookingDone) => void;
}) {
  const t = useThemeColors();
  const country = normalizeCountry(info.country);
  // Одна услуга — она уже выбрана: спрашивать нечего.
  const [serviceId, setServiceId] = useState<string | null>(
    info.services.length === 1 ? info.services[0].id : null,
  );
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slots = useBookingSlots(token, serviceId);
  const days = slots.data ?? [];

  // Окна пришли заново (сменили услугу, время заняли) — выбор, которого
  // больше нет, снимается, а день встаёт на первый свободный.
  useEffect(() => {
    if (!slots.data) return;
    const day = slots.data.find((d) => d.date === date);
    if (!day) {
      setDate(slots.data[0]?.date ?? null);
      setTime(null);
    } else if (time && !day.times.includes(time)) {
      setTime(null);
    }
  }, [slots.data, date, time]);

  const e164 = tryToE164(phone, country);
  const ready = !!serviceId && !!date && !!time && name.trim().length >= 2 && !!e164;

  const submit = async () => {
    if (!ready || sending || !serviceId || !date || !time || !e164) return;
    setError(null);
    setSending(true);
    try {
      const done = await createBooking({ token, serviceId, date, time, name: name.trim(), phone: e164 });
      haptics.success();
      onDone(done);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Не удалось отправить. Повторите.");
      // Время заняли, пока заказчик писал имя, — окна обновляются сами.
      if (e instanceof BookingError && e.hint === "online:taken") void slots.refetch();
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
          Онлайн-запись
        </Text>
        {info.calendarName ? (
          <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 21, color: t.sub }}>{info.calendarName}</Text>
        ) : null}
      </View>

      <View style={{ marginTop: 20 }}>
        <RowGroupHeader title="Услуга" />
        <SelectList>
          {info.services.map((s) => (
            <SelectRow
              key={s.id}
              title={s.name}
              subtitle={durationWords(s.duration) || undefined}
              selected={s.id === serviceId}
              accessibilityRole="radio"
              plain
              onPress={() => setServiceId(s.id)}
            />
          ))}
        </SelectList>
      </View>

      {serviceId ? (
        <View style={{ marginTop: 8 }}>
          <RowGroupHeader title="Время" />
          {slots.isLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Spinner size={22} label="Ищем свободное время" />
            </View>
          ) : slots.isError ? (
            <View style={{ paddingHorizontal: 16 }}>
              <NoticeBar
                tone="error"
                message={slots.error instanceof Error ? slots.error.message : "Не удалось загрузить время."}
              />
            </View>
          ) : days.length === 0 ? (
            <Text style={{ paddingHorizontal: 16, fontSize: 15, lineHeight: 21, color: t.sub }}>
              {`Свободного времени на две недели нет. Позвоните${info.businessName ? ` в ${info.businessName}` : ""}.`}
            </Text>
          ) : (
            <BookingSlotPicker
              days={days}
              date={date}
              time={time}
              onDate={(d) => {
                setDate(d);
                setTime(null);
              }}
              onTime={setTime}
            />
          )}
        </View>
      ) : null}

      {time ? (
        <RowGroup title="Ваши контакты">
          <FieldRow
            label="Имя"
            value={name}
            placeholder="Как вас зовут"
            stacked
            live
            autoCapitalize="words"
            onSave={setName}
          />
          <FieldRow
            label="Телефон"
            value={phone}
            placeholder="Номер для связи"
            stacked
            live
            separated
            keyboardType="phone-pad"
            seed={dialPrefix(country)}
            sanitize={sanitizePhoneInput}
            onSave={setPhone}
          />
        </RowGroup>
      ) : null}

      {time ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          {error ? (
            <View style={{ marginBottom: 12 }}>
              <NoticeBar tone="error" message={error} />
            </View>
          ) : null}
          <Button
            label={sending ? "Записываем…" : "Записаться"}
            onPress={() => void submit()}
            disabled={!ready || sending}
            loading={sending}
          />
        </View>
      ) : null}
    </>
  );
}
