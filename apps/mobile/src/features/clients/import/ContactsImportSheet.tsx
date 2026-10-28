import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Text, View, Platform } from "react-native";
import { randomUuid } from "@babun/shared/sync/uuid";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useClients, useCreateClient } from "@/features/clients/queries";
import { useDefaultCountry } from "@/features/reference/default-country";
import { phoneKey } from "@/features/clients/merge-clients";
import { contactRows, type ContactRow } from "./contact-rows";
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
// остальные выбираются галочками. Лист открывается БЕЗ ЕДИНОЙ ГАЛКИ:
// контакты — чужие данные, и в CRM уходят только те, кого человек отметил
// сам, а не вся книга одним «Добавить 135».

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

export function ContactsImportSheet({
  visible,
  onClose,
  teamId = null,
}: {
  visible: boolean;
  onClose: () => void;
  /** Команда, в которую заводятся клиенты (у каждой команды свой импорт);
   *  нет — сервер ставит первую доступную. */
  teamId?: string | null;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry(teamId);
  const { data: clients = [] } = useClients();
  const create = useCreateClient();

  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState(false);
  // Вернулся из настроек с доступом — перечитать: иначе лист стоял на «Нет
  // доступа», пока его не закроют и не откроют. Проверка без запроса: запрос
  // показывал бы системное окно, а его закрытие снова будило бы этот слушатель.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!visible || !denied || !Contacts) return;
    const api = Contacts;
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      void api
        .getPermissionsAsync()
        .then(({ status }) => {
          if (status === "granted") setRetry((n) => n + 1);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [visible, denied]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  // ПОКОЛЕНИЕ ЗАПУСКА, А НЕ ФЛАГ «ОТМЕНЕНО». Флаг сбрасывало следующее
  // открытие листа, и цикл прошлого запуска, ещё ждавший сервер, досоздавал
  // отменённых клиентов. Закрытие меняет поколение; открытие его не трогает.
  const generation = useRef(0);

  const known = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      const k = phoneKey(c.phone_e164 ?? c.phone, country);
      if (k) set.add(k);
      for (const p of c.phones ?? []) {
        const pk = phoneKey(p.number, country);
        if (pk) set.add(pk);
      }
    }
    return set;
  }, [clients, country]);

  // `known` НЕ в зависимостях: он пересобирается на каждое создание клиента
  // (инвалидация `["clients"]`), и эффект перезапускался прямо посреди
  // импорта — заново спрашивал разрешение, перечитывал книгу и СБРАСЫВАЛ
  // расставленные галки. Свежий снимок берём через ref.
  const knownRef = useRef(known);
  knownRef.current = known;
  useEffect(() => {
    if (!visible) {
      // Лист спрятали снаружи, мимо его собственного закрытия, — запуск тоже
      // устарел.
      generation.current += 1;
      return;
    }
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
        const list = contactRows(data, country, knownRef.current);
        setRows(list);
        // Ничего не отмечено: каждого контакта человек выбирает сам.
        setPicked(new Set());
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
  }, [visible, country, retry]);

  const newCount = rows?.filter((r) => !r.exists).length ?? 0;

  const run = async () => {
    // Ref, а не состояние: два тапа в одном кадре оба видели `busy === false`
    // и запускали ДВА цикла по одному списку — каждый контакт создавался
    // дважды.
    if (!rows || picked.size === 0 || running.current) return;
    running.current = true;
    const gen = generation.current;
    setBusy(true);
    let added = 0;
    const failed: string[] = [];
    for (const row of rows) {
      // Лист закрыли на ходу — прекращаем. Раньше цикл продолжал заводить
      // клиентов уже после того, как человек смахнул лист вниз.
      if (generation.current !== gen) break;
      if (!picked.has(row.key) || row.exists) continue;
      try {
        await create.mutateAsync({
          full_name: row.name,
          phone: row.phone,
          phone_e164: row.phoneE164,
          phones: row.extras.map((e) => ({ ...e, id: randomUuid() })),
          acquisition_source: "other",
          team_id: teamId,
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
    // Лист уже закрыт (и, может быть, открыт заново) — новый не закрываем.
    if (generation.current === gen) onClose();
  };

  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const subtitle = denied
    ? CONTACTS_AVAILABLE
      ? "Нет доступа к контактам"
      : "Недоступно в этой сборке"
    : rows === null
      ? "Читаем контакты…"
      : `${newCount} новых · выбрано ${picked.size}`;
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !needle || r.name.toLowerCase().includes(needle) || r.phone.replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\u0000"),
  );

  // АНАТОМИЯ — КАНОН ШТОРКИ ВЫБОРА (правило 5.2): шапка пропом, поиск, строки
  // `SelectRow`, одна кнопка в футере. Выбор здесь множественный, поэтому
  // кнопка есть и называет число: «Добавить N».
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={() => {
        generation.current += 1;
        onClose();
      }}
      title="Из контактов телефона"
      subtitle={subtitle}
      maxHeightRatio={SELECT_SHEET_RATIO}
      scroll
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          {denied && CONTACTS_AVAILABLE ? (
            // После «Больше не спрашивать» системного окна второй раз нет —
            // дверь в настройки Babun, как у камеры (lib/camera-denied.ts).
            <Button label="Открыть настройки" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button
              label={busy ? "Добавляем…" : `Добавить ${picked.size}`}
              loading={busy}
              disabled={busy || picked.size === 0}
              onPress={() => void run()}
            />
          )}
        </View>
      }
    >
      {denied ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ paddingHorizontal: GUTTER, paddingVertical: 16, fontSize: 13, color: t.sub }}
        >
          {CONTACTS_AVAILABLE
            ? Platform.OS === "android"
              ? "Разрешите доступ к контактам в настройках телефона. Babun читает контакты только когда вы открываете этот список и добавляет в клиенты только отмеченных."
              : "Разрешите доступ к контактам в настройках iPhone. Babun читает контакты только когда вы открываете этот список и добавляет в клиенты только отмеченных."
            : "Адресная книга появится после следующей сборки приложения."}
        </Text>
      ) : (
        <>
          {(rows?.length ?? 0) > 10 ? (
            <SelectSearch
              value={q}
              onChange={setQ}
              placeholder="Имя или телефон"
              accessibilityLabel="Поиск"
              onClear={() => setQ("")}
            />
          ) : null}
          {rows !== null && shown.length === 0 ? (
            <EmptyState title={rows.length === 0 ? "В контактах телефона нет номеров" : "Ничего не найдено"} />
          ) : null}
          <SelectList>
            {shown.map((item) => {
              // Номер, который не разобрался, едет доп. номером — но в строке
              // его видно: человек выбирает контакт и по номеру тоже.
              const number = item.phone || item.extras[0]?.number || "";
              return (
              <SelectRow
                key={item.key}
                title={item.name}
                subtitle={item.exists ? `${number} · уже есть` : number || undefined}
                selected={picked.has(item.key)}
                disabled={item.exists}
                accessibilityRole="checkbox"
                onPress={() => {
                  haptics.tap();
                  toggle(item.key);
                }}
              />
              );
            })}
          </SelectList>
        </>
      )}
    </BottomSheet>
  );
}

export default ContactsImportSheet;
