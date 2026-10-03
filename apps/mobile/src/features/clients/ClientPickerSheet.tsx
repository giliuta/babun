import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { visitMark, type VisitMark } from "@/features/clients/visit-mark";
import { VisitDate, visitMarkWords } from "@/features/clients/VisitDate";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
} from "@/features/appointments/booking-prefill";
import { useClients } from "@/features/clients/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { usePlanAllows } from "@/features/settings/tenant";
import { TariffLocked } from "@/features/tariffs/TariffLocked";

// ВЫБОР КЛИЕНТА — ОДНА ШТОРКА НА ВЕСЬ ПРОДУКТ (владелец 2026-09-10: «если я
// прошу „выбрать клиента", архитектура этой шторки должна быть везде
// одинаковая… и неважно, где я это использую: в календаре, финансах,
// клиентах»).
//
// Их было ДВЕ. Одна жила в записи: недавние наверх, вводная о человеке
// строкой, «Создать клиента „набранное"», дедуп по введённому номеру. Вторая —
// в инвойсе и в «кто привёл»: заголовок нарисован своим `<Text>` в теле, поиск
// — свой второй `TextInput`, пустое состояние — голая строка «Никого не
// нашли», кружок с двумя буквами вместо одной и своим цветом. Один и тот же
// вопрос «кто клиент» задавался двумя разными способами.
//
// Осталась та, что богаче и настроена владельцем; всё, что было только у
// второй (исключить себя, «Убрать»), стало её пропами. Анатомия — общая
// (`select-rows`): заголовок в жесте грабера → поиск → строки 52pt → кнопка в
// футере вне прокрутки.

/** Один сравниватель на модуль: `localeCompare(…, "ru")` в Hermes заводит
 *  новый коллатор на КАЖДОЕ сравнение — сортировка базы была заметной. */
const byName = new Intl.Collator("ru");

/** Дата визита строки — та же, что в списке клиентов; «Историю записей»
 *  закрыли — даты нет. */
function pickerMark(client: Client, stats: ClientStats | undefined): VisitMark | null {
  return clientBlockLevel(client, "clients.history") !== "hidden" ? visitMark(stats) : null;
}

/** Номер и дата визита одной строкой — как под именем в списке клиентов. */
function ClientPhoneVisit({
  client,
  stats,
  country,
}: {
  client: Client;
  stats: ClientStats | undefined;
  country: Parameters<typeof formatPhoneForDisplay>[1];
}) {
  const t = useThemeColors();
  const mark = pickerMark(client, stats);
  const phone = client.phone?.trim() ? formatPhoneForDisplay(client.phone, country) : null;
  if (!phone && !mark) return null;
  return (
    <View className="mt-0.5 flex-row items-center" style={{ gap: 12 }}>
      {phone ? (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ fontSize: 14, color: t.sub, fontVariant: ["tabular-nums"] }}
        >
          {phone}
        </Text>
      ) : null}
      {mark ? <VisitDate mark={mark} /> : null}
    </View>
  );
}

export function ClientPickerSheet({
  visible,
  title = "Клиент",
  clients: given,
  selectedId,
  excludeId,
  excludeIds,
  recentIds,
  statsById,
  linkFor,
  autoFocusSearch,
  onCreate,
  onSelect,
  onDeselect,
  onClear,
  clearLabel,
  onClose,
  onExited,
}: {
  visible: boolean;
  /** Чью метку правят — «Клиент», «Кто привёл», «Клиент инвойса». */
  title?: string;
  /** Готовый список. Нет — берём весь справочник сами. */
  clients?: Client[];
  selectedId?: string | null;
  /** Кого не предлагать (себя же — в «кто привёл»). */
  excludeId?: string | null;
  /** КРУГ СВЯЗЕЙ ЗАПРЕЩЁН В ДВЕРИ (STORY-086, решение 4). Связь живёт у того,
   *  кто входит: привязать Екатерину к Павлу — значит вписать Павла в её
   *  `memberships`. Если Павел уже вписан в Екатерину, оба окажутся друг у
   *  друга и в «Людях», и в строке «чей он», и снять это нечем. Поэтому
   *  дверь, открытая на карточке Павла, не предлагает те карточки, членом
   *  которых состоит САМ Павел (их и считает `LinkPickerSheet`).
   *
   *  Сервер этого НЕ сторожит намеренно: триггеру пришлось бы читать чужие
   *  строки ради вежливости интерфейса. */
  excludeIds?: readonly string[];
  /** Недавние наверх: в девяти случаях из десяти записывают того, кто уже был. */
  recentIds?: string[];
  /** Долг, визиты, деньги, последний визит — вводная о человеке (владелец
   *  2026-09-04: «когда я выбираю клиента, там должна быть уже вводная
   *  информация, как это написано в клиентах»). Считает вызывающий: карта на
   *  весь список строится один раз, а не по клиенту на строку. */
  statsById?: Map<string, ClientStats>;
  /** Чей это человек — «жена · Павел Иванов», «жилец · Наталья · Вилла 5»
   *  (STORY-086). Звонит Екатерина — по строке видно, что запись встанет на
   *  Павла. Нет связи — строки нет.
   *
   *  СТРОКА ОДНА, А СВЯЗЕЙ БЫВАЕТ НЕСКОЛЬКО (жилец двух вилл одной
   *  управляющей): что печатать, решает не шторка, а общий построитель
   *  `linkLine` — первую связь и « +N» хвостом (решение 6). Здесь строка
   *  только показывается: полный перечень виден на карточке. */
  linkFor?: (client: Client) => string | undefined;
  /** Курсор сразу в поиске — у шторки, поднятой дверью с готовым вопросом
   *  («Кто это», «Кто здесь живёт»): человека там ИЩУТ по имени, и
   *  лишний тап в поле стоял бы между вопросом и ответом. У «Кто привёл» и
   *  у выбора клиента в записи автофокуса нет: там сначала смотрят список
   *  недавних, и клавиатура закрыла бы его половину. */
  autoFocusSearch?: boolean;
  /** Заводить клиента прямо отсюда. Нет обработчика — ни строки, ни кнопки:
   *  у инвойса и у «кто привёл» создавать некого. */
  onCreate?: (prefill: { name?: string; phone?: string }) => void;
  onSelect: (client: Client) => void;
  /** ПОВТОРНЫЙ ТАП ПО ВЫБРАННОМУ СНИМАЕТ ВЫБОР (владелец 2026-09-22: «нажимаю
   *  ещё раз на Андрея — он снимается»). Нет пропа — тап всегда выбирает. */
  onDeselect?: () => void;
  /** «Убрать» — снять уже выбранного. */
  onClear?: () => void;
  clearLabel?: string;
  onClose: () => void;
  /** Шторка ПОЛНОСТЬЮ ушла и её окно снято. Раньше этого момента другое окно —
   *  вторая шторка, карточка клиента — открыть нельзя: iOS отвечает «already
   *  presenting» и не показывает вовсе. Цепочка «клиент → услуги» ждёт именно
   *  этот сигнал. */
  onExited?: () => void;
}) {
  const t = useThemeColors();
  // Номер — тем же правилом, что в списке клиентов (аудит 29.09: в списке
  // «99 000 001», а здесь тот же человек был «+357 99000001»).
  const country = useDefaultCountry();
  const { data: all = [] } = useClients();
  const clients = given ?? all;
  const [q, setQ] = useState("");
  // Что сделать, когда шторка ПОЛНОСТЬЮ уйдёт (см. `onExited`).
  const afterExit = useRef<(() => void) | null>(null);

  // Набор запрещённых собирается ОДИН раз на список, а не сканируется на
  // каждую строку: у владельца справочник на сотни имён.
  const banned = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const pool = useMemo(
    () =>
      clients.filter(
        (c) => c.id !== excludeId && !banned.has(c.id) && !c.deleted_at,
      ),
    [clients, excludeId, banned],
  );

  const quickDraft = useMemo(() => buildQuickClientDraft(q), [q]);
  const duplicate = useMemo(
    () => findQuickClientDuplicate(pool, quickDraft.phone_e164),
    [pool, quickDraft.phone_e164],
  );

  // ПРИ ПУСТОМ ПОИСКЕ ВИДНЫ ВСЕ, А НЕ ТОЛЬКО НЕДАВНИЕ (владелец 2026-08-31:
  // «я вроде создал клиента, но он не создался — проверяй это»). Клиент
  // создавался исправно; не показывался, потому что «недавние» — это те, у
  // кого УЖЕ были записи, а у новорождённого их нет по определению.
  const rows = useMemo(() => {
    const query = q.trim();
    if (query) return pool.filter((c) => matchesClient(c, query));
    if (!recentIds?.length) {
      return [...pool].sort((a, b) => byName.compare(a.full_name || "", b.full_name || ""));
    }
    const byId = new Map(pool.map((c) => [c.id, c]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((c): c is Client => Boolean(c));
    const seen = new Set(recent.map((c) => c.id));
    const others = pool
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => byName.compare(a.full_name || "", b.full_name || ""));
    return [...recent, ...others];
  }, [pool, q, recentIds]);

  // ПОИСК НЕ ПОМНИТ ПРОШЛЫЙ ЗАПРОС: шторка остаётся смонтированной между
  // открытиями, и набранное переживало выбор.
  const close = () => {
    setQ("");
    onClose();
  };
  const pick = (client: Client) => {
    haptics.tap();
    setQ("");
    if (onDeselect && client.id === selectedId) onDeselect();
    else onSelect(client);
    close();
  };

  /** Набранное в поиске и есть будущий клиент — уносим его в карточку.
   *  Найденный по номеру дубль — не создание, а выбор: два клиента на одном
   *  номере невозможны. */
  const typedName = q.trim();
  const clientsInPlan = usePlanAllows("clients");
  const createLabel = duplicate
    ? `Выбрать «${duplicate.full_name || duplicate.phone || typedName}»`
    : typedName
      ? `Создать «${typedName}»`
      : "Создать клиента";

  const create = () => {
    if (!onCreate) return;
    if (duplicate) {
      pick(duplicate);
      return;
    }
    const typed = q.trim();
    const prefill = !typed
      ? {}
      : quickDraft.kind === "phone"
        ? { phone: quickDraft.phone }
        : { name: quickDraft.full_name };
    afterExit.current = () => onCreate(prefill);
    close();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        // Ушли заводить клиента — цепочке услуг здесь делать нечего: она
        // продолжится, когда человек вернётся с новым клиентом.
        if (run) {
          run();
          return;
        }
        onExited?.();
      }}
      title={title}
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        onCreate || (onClear && selectedId) ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            {/* ДВЕРЬ СОЗДАНИЯ ОДНА — В ФУТЕРЕ (22.09, прогон «Добавить →
                Человек»): под пустым поиском стояли ДВЕ одинаковые двери —
                строка «Создать клиента «Мария»» и кнопка «Создать клиента».
                Строка ушла, а кнопка называет набранное сама: видно, кого
                именно заведут, и найденный по номеру дубль она выбирает, а не
                заводит второй раз. */}
            {/* БЕЗ ТАРИФА НОВОГО КЛИЕНТА НЕ ЗАВЕСТИ НИ ОТКУДА (владелец 02.10:
                «нажимаю на клиента — там „Создать клиента“, и можно создать
                любого»). Кнопка серая, тап — плашка про тариф; найденного по
                номеру выбрать можно — это не создание. */}
            {onCreate ? (
              <TariffLocked locked={!duplicate && !clientsInPlan} beforeNudge={close}>
                <Button label={createLabel} onPress={create} />
              </TariffLocked>
            ) : null}
            {onClear && selectedId ? (
              <Button
                label={clearLabel ?? "Убрать"}
                variant="secondary"
                tone="danger"
                onPress={() => {
                  haptics.tap();
                  onClear();
                  close();
                }}
              />
            ) : null}
          </View>
        ) : undefined
      }
    >
      <SelectSearch
        value={q}
        onChange={setQ}
        placeholder="Имя или телефон"
        accessibilityLabel="Поиск клиента"
        onClear={() => setQ("")}
        autoCapitalize="words"
        autoFocus={autoFocusSearch}
      />
      <SelectList>
        {rows.length > 0 ? (
          rows.map((c) => (
            <SelectRow
              key={c.id}
              title={c.full_name || "Без имени"}
              // СТРОКА — КАК В СПИСКЕ КЛИЕНТОВ (владелец 03.10: «тут тоже не
              // нужно показывать долг, „два визита“… и кругляшки с именем —
              // мы нигде их не используем»): имя, под ним номер и дата визита
              // цветом (`VisitDate`). Без кружка с буквой.
              subtitle={
                <>
                  <ClientPhoneVisit client={c} stats={statsById?.get(c.id)} country={country} />
                  {linkFor?.(c) ? (
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                        style={{ fontSize: 13, color: t.sub }}
                      >
                        {linkFor(c)}
                      </Text>
                    ) : null}
                </>
              }
              selected={c.id === selectedId}
              accessibilityLabel={[
                c.full_name || "Без имени",
                c.phone,
                linkFor?.(c) ?? "",
                (() => {
                  const mark = pickerMark(c, statsById?.get(c.id));
                  return mark ? visitMarkWords(mark) : "";
                })(),
              ]
                .filter(Boolean)
                .join(", ")}
              onPress={() => pick(c)}
            />
          ))
        ) : (
          <EmptyState
            title={q.trim() ? "Клиенты не найдены" : "Клиентов пока нет"}
          />
        )}

      </SelectList>
    </BottomSheet>
  );
}

export default ClientPickerSheet;
