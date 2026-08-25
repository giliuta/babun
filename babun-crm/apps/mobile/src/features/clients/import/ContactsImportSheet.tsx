import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import type { CountryCode } from "libphonenumber-js";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/Toast";
import { useClients, useCreateClient } from "@/features/clients/queries";
import { useDefaultCountry } from "@/features/clients/default-country";
import { phoneKey } from "@/features/clients/merge-clients";
import { formatPhoneAsYouType, tryToE164 } from "@/features/clients/phone";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ИМПОРТ ИЗ КОНТАКТОВ ТЕЛЕФОНА.
//
// У малого сервисного бизнеса база лежит не в CSV, а в телефоне: «Петрос
// кондиционер», «Мария вилла», «Андреас бассейн». Мастер CSV для этого
// требует сначала выгрузить таблицу — то есть не сделать никогда.
//
// Здесь список контактов с номерами: уже заведённые отмечены и выключены
// (сверка по последним 8 цифрам — тот же ключ, что у слияния дублей),
// остальные выбираются галочками. Ничего не пишется, пока не нажали
// «Добавить»: контакты — чужие данные, и молча заливать их в CRM нельзя.

// expo-contacts может отсутствовать в старом дев-билде — тот же охранный
// require, что в useClientDraft.
let Contacts: typeof import("expo-contacts") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Contacts = require("expo-contacts");
} catch {
  Contacts = null;
}

/** Есть ли доступ к адресной книге в ЭТОЙ сборке. Строку в настройках
 *  показываем только тогда: кнопка, которая ничего не делает, хуже её
 *  отсутствия (в старом дев-билде нативного модуля просто нет). */
export const CONTACTS_AVAILABLE = Contacts !== null;

interface Row {
  key: string;
  name: string;
  phone: string;
  /** Уже есть в базе — показываем, но не даём выбрать. */
  exists: boolean;
}

export function ContactsImportSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry();
  const { data: clients = [] } = useClients();
  const create = useCreateClient();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const cancelled = useRef(false);

  const known = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      const k = phoneKey(c.phone);
      if (k) set.add(k);
      for (const p of c.phones ?? []) {
        const pk = phoneKey(p.number);
        if (pk) set.add(pk);
      }
    }
    return set;
  }, [clients]);

  // `known` НЕ в зависимостях: он пересобирается на каждое создание клиента
  // (инвалидация `["clients"]`), и эффект перезапускался прямо посреди
  // импорта — заново спрашивал разрешение, перечитывал книгу и СБРАСЫВАЛ
  // расставленные галки во «всё новое». Свежий снимок берём через ref.
  const knownRef = useRef(known);
  knownRef.current = known;
  useEffect(() => {
    if (!visible) return;
    cancelled.current = false;
    if (!Contacts) {
      setDenied(true);
      return;
    }
    // Сбрасываем прошлый отказ: человек мог уйти в Настройки iPhone и выдать
    // доступ — без сброса лист навсегда оставался «Нет доступа».
    setDenied(false);
    let alive = true;
    void (async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (!alive) return;
        if (status !== "granted") {
          setDenied(true);
          return;
        }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        });
        if (!alive) return;
      const seen = new Set<string>();
      const list: Row[] = [];
      for (const c of data) {
        const raw = c.phoneNumbers?.[0]?.number ?? "";
        const key = phoneKey(raw);
        if (!key || key.length < 5 || seen.has(key)) continue;
        seen.add(key);
        list.push({
          key,
          name:
            c.name ||
            [c.firstName, c.lastName].filter(Boolean).join(" ") ||
            formatPhoneAsYouType(raw, country),
          phone: formatPhoneAsYouType(raw, country),
          exists: knownRef.current.has(key),
        });
      }
        list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        setRows(list);
        // По умолчанию отмечено всё новое: чаще всего человек хочет именно
        // это, а снять лишнее проще, чем отметить сотню.
        setPicked(new Set(list.filter((r) => !r.exists).map((r) => r.key)));
      } catch {
        // Нативный модуль может упасть (нет NSContactsUsageDescription,
        // отозвали доступ на ходу). Без catch лист навсегда застревал на
        // «Читаем контакты…» с unhandled rejection.
        if (alive) setDenied(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, country]);

  const newCount = rows?.filter((r) => !r.exists).length ?? 0;

  const run = async () => {
    // Ref, а не состояние: два тапа в одном кадре оба видели `busy === false`
    // и запускали ДВА цикла по одному списку — каждый контакт создавался
    // дважды.
    if (!rows || picked.size === 0 || running.current) return;
    running.current = true;
    setBusy(true);
    let added = 0;
    const failed: string[] = [];
    for (const row of rows) {
      // Лист закрыли на ходу — прекращаем. Раньше цикл продолжал заводить
      // клиентов уже после того, как человек смахнул лист вниз.
      if (cancelled.current) break;
      if (!picked.has(row.key) || row.exists) continue;
      try {
        await create.mutateAsync({
          full_name: row.name,
          phone: row.phone,
          phone_e164: tryToE164(row.phone, country as CountryCode),
          acquisition_source: "other",
        });
        added += 1;
      } catch {
        failed.push(row.name);
      }
    }
    setBusy(false);
    running.current = false;
    if (added > 0) haptics.success();
    else haptics.warning();
    toast(
      failed.length === 0
        ? `Добавлено ${added}`
        : `Добавлено ${added}, не удалось ${failed.length}`,
      failed.length === 0 ? "success" : "error",
    );
    onClose();
  };

  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      maxHeightRatio={0.92}
    >
      <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 6 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          Из контактов телефона
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 13, color: t.sub, marginTop: 2 }}
        >
          {denied
            ? CONTACTS_AVAILABLE
              ? "Нет доступа к контактам"
              : "Недоступно в этой сборке"
            : rows === null
              ? "Читаем контакты…"
              : `${newCount} новых · выбрано ${picked.size}`}
        </Text>
      </View>

      {denied ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 16,
            fontSize: 13,
            color: t.sub,
          }}
        >
          {CONTACTS_AVAILABLE
            ? "Разрешите доступ к контактам в настройках iPhone — Babun читает их только по этой кнопке и ничего не отправляет наружу."
            : "Адресная книга появится после следующей сборки приложения."}
        </Text>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={(r) => r.key}
          style={{ flexShrink: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 8,
            gap: 8,
          }}
          ListEmptyComponent={
            rows === null ? null : (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  paddingVertical: 18,
                  textAlign: "center",
                  fontSize: 13,
                  color: t.faint,
                }}
              >
                В контактах телефона нет номеров
              </Text>
            )
          }
          renderItem={({ item }) => {
            const on = picked.has(item.key);
            return (
              <Pressable
                onPress={() => {
                  if (item.exists) return;
                  haptics.tap();
                  toggle(item.key);
                }}
                disabled={item.exists}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: item.exists }}
                accessibilityLabel={`${item.name}, ${item.phone}`}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  borderRadius: t.radius.input,
                  backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: item.exists ? t.faint : t.ink,
                    }}
                  >
                    {item.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    style={{ fontSize: 13, color: t.sub }}
                  >
                    {item.exists ? `${item.phone} · уже есть` : item.phone}
                  </Text>
                </View>
                {on && !item.exists ? (
                  <Check color={t.accent} size={18} strokeWidth={2.4} />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}>
        <Pressable
          onPress={() => void run()}
          disabled={busy || picked.size === 0}
          accessibilityRole="button"
          accessibilityLabel={`Добавить ${picked.size}`}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.input,
            backgroundColor:
              busy || picked.size === 0 ? t.fill : pressed ? t.pressed : t.accent,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: busy || picked.size === 0 ? t.faint : t.onAccent,
            }}
          >
            {busy ? "Добавляем…" : `Добавить ${picked.size}`}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

export default ContactsImportSheet;
