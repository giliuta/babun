import { useEffect, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import {
  COUNTRY_NAMES_RU,
  SUPPORTED_COUNTRIES,
  composePhone,
  countryDialCode,
  countryFlag,
  formatPhoneAsYouType,
  nationalPart,
  phoneCountryOf,
} from "@/features/clients/phone";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРАНА НОМЕРА — ПОДПИСЬЮ НАД ПОЛЕМ (владелец 22.09: «надо сделать именно
// удобное вписывание номера телефона… выбор кода страны»). Поле держит только
// цифры номера группами по маске страны, а «🇨🇾 Кипр +357» стоит подписью над
// ним и тапом открывает список стран. В данные уходит полный номер
// («+357 99887766»), поэтому номер чужой страны не зависит от страны
// компании. Набрали «+7…» сами — страна переключается по коду.

export function usePhoneCountry({
  phone,
  home,
  onChange,
}: {
  /** Полный номер, как он лежит в черновике. */
  phone: string;
  /** Страна компании — с неё начинается пустое поле. */
  home: CountryCode;
  onChange: (full: string) => void;
}) {
  const t = useThemeColors();
  const [country, setCountry] = useState<CountryCode>(() => phoneCountryOf(phone, home));
  const [open, setOpen] = useState(false);
  // ПОИСК ПО СПИСКУ: стран 29, и «Великобритания» ищется быстрее набором,
  // чем глазами. Ищем и по названию, и по коду («44»).
  const [q, setQ] = useState("");
  const dialDigits = countryDialCode(country).slice(1);
  const digits = phone.replace(/\D/g, "");
  // Номер набран своим «+» и код ещё не дописан (или это код другой
  // страны) — показываем как набран: иначе поле съело бы «+» под пальцем.
  const ownCode = !phone.trim().startsWith("+") || digits.startsWith(dialDigits);

  // Номер пришёл СНАРУЖИ (вставка «Мария +7 916…» в имя делит её, номер
  // уезжает сюда) — подпись следует за его кодом (аудит 22.09).
  useEffect(() => {
    const s = phone.trim();
    if (!s.startsWith("+")) return;
    const next = phoneCountryOf(s, home);
    if (s.replace(/\D/g, "").length > countryDialCode(next).length - 1) {
      setCountry((cur) => (cur === next ? cur : next));
    }
  }, [phone, home]);

  const onType = (typed: string) => {
    const s = typed.trim();
    if (s.startsWith("+")) {
      const next = phoneCountryOf(s, home);
      // Страну меняем, только когда её код набран целиком.
      if (s.replace(/\D/g, "").length > countryDialCode(next).length - 1) setCountry(next);
    }
    onChange(composePhone(typed, country));
  };

  const pick = (next: CountryCode) => {
    setCountry(next);
    // Цифры — по коду САМОГО номера: подпись могла ещё не догнать вставку,
    // и тогда код прежней страны ушёл бы в цифры («+7 7916…»).
    const from = phone.trim().startsWith("+") ? phoneCountryOf(phone, home) : country;
    const national = nationalPart(phone, from);
    // Цифр ещё нет — поле пустеет: иначе под новой страной оставался бы
    // код прежней («Россия +7» и «+357» в поле, снято 22.09 на симуляторе).
    onChange(national ? composePhone(national, next) : "");
  };

  return {
    label: `${countryFlag(country)} ${COUNTRY_NAMES_RU[country] ?? country} ${countryDialCode(country)}`,
    value: ownCode ? nationalPart(phone, country) : formatPhoneAsYouType(phone, home),
    onType,
    openPicker: () => {
      haptics.tap();
      setOpen(true);
    },
    sheet: (
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        onExited={() => setQ("")}
        title="Код страны"
        padded={false}
        scroll
        maxHeightRatio={SELECT_SHEET_RATIO}
      >
        <SelectSearch
          value={q}
          onChange={setQ}
          placeholder="Страна или код"
          accessibilityLabel="Поиск страны"
          onClear={() => setQ("")}
          autoCapitalize="words"
        />
        <SelectList>
          {SUPPORTED_COUNTRIES.filter((code) => {
            const needle = q.trim().toLowerCase().replace(/^\+/, "");
            if (!needle) return true;
            const name = (COUNTRY_NAMES_RU[code] ?? code).toLowerCase();
            return name.includes(needle) || countryDialCode(code).slice(1).startsWith(needle);
          }).map((code) => (
            <SelectRow
              key={code}
              icon={countryFlag(code)}
              color={t.accent}
              title={COUNTRY_NAMES_RU[code] ?? code}
              hint={countryDialCode(code)}
              selected={code === country}
              onPress={() => {
                haptics.tap();
                pick(code);
                setOpen(false);
              }}
            />
          ))}
        </SelectList>
      </BottomSheet>
    ),
  };
}
