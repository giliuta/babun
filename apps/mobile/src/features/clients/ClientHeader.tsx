// БЛОК ИДЕНТИЧНОСТИ клиента — одна вёрстка на просмотр и создание
// (решение владельца 2026-07-14 «одна страница», уточнено 2026-07-26:
// «разделить чётко — имя, номер телефона, можно добавить второй номер,
// третья строка объекты и так далее; всё в своём блоке и всегда можно
// редактировать»).
//
// БЫЛО «постер»: имя крупным заголовком, телефон мелкой строкой под ним,
// деньги и доверие — стопкой текста. На экране создания это читалось
// перевёрнуто (заголовок «Имя», а курсор стоит в номере), и было
// неочевидно, где вообще границы полей.
//
// СТАЛО стопка ЯВНЫХ СТРОК одного диалекта с фильтрами: «ярлык слева …
// значение справа», тап = правка на месте. Дополнительные номера
// (`client.phones`) живут ЗДЕСЬ, рядом с основным, а не в дальнем блоке
// «Контакты» — второй номер нужен там же, где первый.
//
// ЗВОНКА/SMS ЗДЕСЬ НЕТ: каждое действие живёт ровно в одном месте —
// hero «Записать» + ряд card-actions.
//
// Presentational. Правки персистит через `update`; телефон сохраняется
// ВМЕСТЕ с производным phone_e164 — иначе ключ дедупа
// (findClientByPhoneE164 + DB unique index) остался бы от старого номера.

import { useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  Bell,
  Briefcase,
  Check,
  ChevronRight,
  Home,
  MessageCircle,
  Phone,
  Smartphone,
  type LucideIcon,
} from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  formatShortDateRu,
  reminderBadge,
  visitsWord,
} from "@/features/clients/format";
import {
  dialPrefix,
  formatPhoneAsYouType,
  isDialOnly,
  tryToE164,
} from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { clientDebt } from "@/features/clients/filter";
import {
  FieldRow,
  RowActionButton,
  RowGroup,
} from "@/components/ui/card-rows";
import {
  AddContactSheet,
  type AddContactChoice,
} from "@/features/clients/AddContactSheet";
import {
  CONTACT_FIELDS,
  type ContactFieldId,
} from "@/features/clients/contact-fields";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useToast } from "@/components/ui/Toast";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { AddRow } from "@/components/ui/AddRow";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";

/** Режим создания: то, что знает только композер экрана.
 *
 *  Имя и телефон здесь редактируются ЖИВО (onChangeText), а не по blur как
 *  в карточке: «Готово» читает черновик из замыкания текущего рендера, и
 *  blur-сохранение не успело бы долететь — клиент создавался бы без только
 *  что набранного имени. В карточке blur безопасен: там update = PATCH. */
export interface ClientHeaderDraft {
  /** Номер уже валиден (E.164) — рисуем ✓ у поля. */
  valid: boolean;
  /** Живой ввод имени (см. коммент выше). */
  onNameChange: (v: string) => void;
  /** Живой ввод номера: AsYouType + сброс дедупа (владеет композер). */
  onPhoneChange: (v: string) => void;
  /** Баннер дедупа / ошибка создания — внутри блока, под номером. */
  footer?: ReactNode;
  /** Куда встаёт курсор при открытии. По умолчанию — в телефон (ключ
   *  дедупа); когда телефон уже набран в поиске записи, — в имя. */
  focus?: "name" | "phone";
}

interface ClientHeaderProps {
  client: Client;
  stats: ClientStats | undefined;
  /** Возвращает false, если запись не удалась: писатель массива номеров по
   *  этому ответу ОТКАТЫВАЕТ оптимистичное значение. Подменённый `true`
   *  выключал откат, и неудачная правка тихо уезжала в базу со следующей
   *  удачной (найдено аудитом 2026-07-27). */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  draft?: ClientHeaderDraft;
  /** Открыть историю записей. Сводка под номером САМА и есть вход в историю
   *  (владелец 2026-08-02: «место истории записей можно сразу писать „6
   *  визитов · €600 · был 30 мая" и сделать это кликабельным»). Не задан —
   *  сводка остаётся просто текстом (черновик, клиент без единой записи). */
  onOpenHistory?: () => void;
}

/** Стабильная пустая ссылка: `?? []` давал новый массив на каждый рендер и
 *  дёргал пересинхронизацию писателя. */
const EMPTY_PHONES: PhoneEntry[] = [];

// СТАНДАРТНЫЙ НАБОР ПОДПИСЕЙ, как в контактах iPhone (владелец 2026-07-27:
// «что значит „Второй"? напиши сотовый, рабочий — стандартная, как у iPhone;
// не муж-жена»). Родственные подписи («Супруг(а)») убраны: это про отношения,
// а не про номер, и у бизнес-клиента их не бывает.
const EXTRA_LABELS = ["Мобильный", "Рабочий", "Домашний", "WhatsApp", "Другой"];

/** Значок подписи — тот же язык, что у остальных листов продукта. */
const LABEL_ICONS: Record<string, LucideIcon> = {
  Мобильный: Smartphone,
  Рабочий: Briefcase,
  Домашний: Home,
  WhatsApp: MessageCircle,
  Другой: Phone,
};

function nextExtraLabel(existing: PhoneEntry[]): string {
  const used = new Set(existing.map((p) => p.label));
  return EXTRA_LABELS.find((l) => !used.has(l)) ?? "Другой";
}

export default function ClientHeader({
  client,
  stats,
  update,
  draft,
  onOpenHistory,
}: ClientHeaderProps) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry();

  const extras = client.phones ?? EMPTY_PHONES;
  // Номера — тот же jsonb-массив, что объекты: писать его можно только из
  // свежайшего значения и по очереди, иначе две быстрые правки затирают друг
  // друга (patchPhone из снимка рендера + PATCH на всю колонку).
  const phones = useJsonArrayWriter<PhoneEntry>(extras, (next) =>
    Promise.resolve(update({ phones: next })).then((ok) => ok !== false),
  );

  // Новый номер живёт ЛОКАЛЬНО, пока в нём нет цифр: тап по «+ Добавить
  // номер» раньше сразу писал в базу пустую запись, и у клиента навсегда
  // оставалась строка «WHATSAPP — Номер», в которую никто не дописал номер.
  // Пустое поле не является номером, и в данных его быть не должно.
  // Новый номер: id решается СРАЗУ (на тапе «+ Добавить номер»), но в данные
  // ничего не пишется, пока нет первой цифры. Строка при этом не подменяется
  // другой — иначе набор прерывался бы на середине, а запись создавалась бы
  // на каждый символ.
  const [pending, setPending] = useState<{ label: string; id: string } | null>(
    null,
  );
  // Коммит строки происходит и на РАЗМОНТИРОВАНИИ — там читается замыкание
  // прошлого рендера, поэтому актуальное состояние держим ещё и в ref.
  const pendingRef = useRef(pending);
  const setPendingRow = (next: { label: string; id: string } | null) => {
    pendingRef.current = next;
    setPending(next);
  };

  const addPhone = () => {
    setPendingRow({ label: nextExtraLabel(extras), id: randomUuid() });
  };

  // Что добавляют плюсом: номер или способ связи. Пустое поле мессенджера
  // живёт ТОЛЬКО пока его заполняют — уйти со строки, ничего не написав,
  // значит не добавлять ничего (тот же закон, что у нового номера).
  const [addOpen, setAddOpen] = useState(false);
  const [addingField, setAddingField] = useState<ContactFieldId | null>(null);
  // Что НАБИРАЮТ прямо сейчас (без записи в базу): по этому значению строка
  // решает, показывать ли значок перехода. Иначе кнопка «открыть Telegram»
  // появлялась только после ухода со строки — набрал логин, а реакции нет.
  const [typing, setTyping] = useState<{ id: ContactFieldId; value: string } | null>(
    null,
  );
  const onPickAdd = (choice: AddContactChoice) => {
    if (choice === "phone") {
      addPhone();
      return;
    }
    setAddingField(choice);
  };
  /** Новый номер становится записью, как только в нём появилась ПЕРВАЯ цифра.
   *  Раньше это происходило только по blur — и в черновике «Готово» читало
   *  объект без набранного номера, а на карточке уход по «Назад» терял его.
   *  Пустое поле записью не становится вовсе. */
  const commitPending = (raw: string) => {
    const value = raw.trim();
    const row = pendingRef.current;
    // Уже отменили или закоммитили — второй раз не пишем.
    if (!row) return;
    const { id, label } = row;
    void phones.apply((all) => {
      const rest = all.filter((p) => p.id !== id);
      // Пустое поле записью не становится, а уже созданную стирает: строки
      // «WHATSAPP — Номер» без номера в данных быть не должно. Один код
      // страны — тоже пусто: это подставленная подсказка, а не номер.
      return isDialOnly(value, country)
        ? rest
        : [...rest, { id, number: value, label }];
    });
  };
  const patchPhone = (id: string, patch: Partial<PhoneEntry>) =>
    void phones.apply((all) =>
      all.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  /** Правка номера. СТЁРТЫЙ номер = убранный номер (владелец 2026-08-02:
   *  «крестик убирай — он удаляется автоматически, если там ничего не
   *  написано»). Тот же закон, что у новой строки: поле без цифр записью не
   *  является, и строки «МОБИЛЬНЫЙ — Номер» без номера в данных не остаётся. */
  const savePhone = (id: string, raw: string, live: boolean) => {
    const value = raw.trim();
    if (!isDialOnly(value, country)) {
      patchPhone(id, { number: value });
      return;
    }
    // В ЧЕРНОВИКЕ строка пишется на КАЖДЫЙ символ — удалять её на пустом поле
    // нельзя: сотрёшь номер, чтобы перенабрать, а строка исчезает вместе с
    // клавиатурой, и набор уходит в никуда. Пустой номер там просто хранится
    // и отсеивается при создании клиента.
    if (live) {
      patchPhone(id, { number: value });
      return;
    }
    haptics.tap();
    void phones.apply((all) => all.filter((p) => p.id !== id));
  };
  /** Подпись выбирается СНИЗУ из стандартного набора — тем же листом со
   *  значками, что «Добавить» и «Как связаться» (единый дизайн списков).
   *  Перебор по кругу требовал до пяти тапов и не показывал, что есть. */
  const [labelFor, setLabelFor] = useState<PhoneEntry | null>(null);

  // Долг — общей формулой продукта, а не своей. Раньше здесь стояло сырое
  // `stats.debt`, а список и фильтр считали иначе: карточка молчала о долге,
  // который список печатал крупно. Три формулы на трёх экранах — прямая
  // причина «я не верю этим числам» (владелец 2026-08-07).
  const debtAmount = clientDebt(client, stats);
  const debt = debtAmount > 0 ? formatEUR(debtAmount) : null;
  // «Напомнить» (card-actions) пишет reminder_at — строка делает дату
  // видимой: серая, когда впереди, красная — сегодня/прошло.
  const badge = reminderBadge(client.reminder_at);
  const nextApt = stats?.nextApt ?? null;
  // СВОДКА ДОВЕРИЯ. Не один серый абзац, а факты РАЗНОГО ВЕСА (владелец
  // 2026-08-06: «не нравится, что „6 визитов · €600 · был 30 мая“ серым —
  // надо, чтоб выделялось»): сколько раз приезжали и сколько денег принесли —
  // чернилами и деньгами, «когда были» — тихо, «записан» — кобальтом, потому
  // что это единственный факт про БУДУЩЕЕ.
  const trustSegments: { text: string; color: string; weight: "400" | "600" | "700" }[] =
    stats
      ? [
          stats.visits > 0
            ? {
                text: `${stats.visits} ${visitsWord(stats.visits)}`,
                color: t.ink,
                weight: "700" as const,
              }
            : null,
          stats.totalSpent > 0
            ? {
                text: formatEUR(stats.totalSpent),
                color: t.success,
                weight: "700" as const,
              }
            : null,
          stats.lastVisitDate
            ? {
                text: `был ${formatShortDateRu(stats.lastVisitDate)}`,
                color: t.sub,
                weight: "400" as const,
              }
            : null,
          // Предстоящая запись — здесь же, а не отдельной строкой: это такой
          // же факт «когда», как «был 27 мая», только про будущее.
          nextApt
            ? {
                text: `записан ${formatShortDateRu(nextApt.date)} · ${nextApt.time}`,
                color: t.accent,
                weight: "600" as const,
              }
            : null,
        ].filter((x): x is NonNullable<typeof x> => x !== null)
      : [];

  return (
    <>
      <RowGroup>
        {/* Имя — ОБЯЗАТЕЛЬНОЕ (владелец 2026-07-26): безымянного клиента не
          найти ни поиском, ни глазами, и в SMS-шаблон нечего подставить. */}
        <FieldRow
          label="Имя"
          value={client.full_name}
          placeholder="Обязательно"
          big
          stacked
          live={!!draft}
          autoFocus={draft?.focus === "name"}
          // Имя обязательно НЕ только при создании: на сохранённой карточке
          // его тоже нельзя стереть в ноль — безымянного клиента не найти ни
          // поиском, ни глазами в списке. Пустое просто не пишем, строка
          // возвращает прежнее значение.
          onSave={(v) => {
            if (draft) {
              draft.onNameChange(v);
              return;
            }
            if (v.trim()) {
              update({ full_name: v.trim() });
              return;
            }
            haptics.warning();
            toast("Имя обязательно", "error");
          }}
          trailing={
            draft && client.full_name.trim() ? (
              <Check color={t.success} size={18} strokeWidth={2.5} />
            ) : null
          }
        />

        {/* Телефон вторым (порядок владельца 2026-07-26: сначала имя).
          Ярлык сверху, значение по левому краю — печатать в правое
          выравнивание неудобно.

          ЯРЛЫКИ ЗДЕСЬ ПОКА ОСТАЮТСЯ. Попытка убрать их совсем и увести
          подпись вправо от номера (2026-08-06) сделала блок пустым и
          нечитаемым — владелец: «стало ещё хуже, просто номера и всё».
          Вид блока переосмысливается отдельно. */}
        <FieldRow
          separated
          // «Телефон» — ИМЯ ПОЛЯ, а не тип номера: над цифрами оно называло
          // очевидное. В Контактах Apple слова «телефон» нет вовсе — там сразу
          // «мобильный»/«рабочий». Здесь подпись появляется, только когда
          // номеров БОЛЬШЕ ОДНОГО: пока номер один, различать нечего.
          label={extras.length > 0 ? "Основной" : ""}
          hideLabel={extras.length === 0}
          // ПОКАЗЫВАЕМ ГРУППАМИ: «+357 97 469 998», а не «+35797469998».
          // Форматирование жило только в черновике создания, а на сохранённой
          // карточке номер печатался как лежит в базе — стена из одиннадцати
          // цифр и была половиной ощущения «некрасиво» (2026-08-06).
          value={formatPhoneAsYouType(client.phone, country)}
          placeholder="Обязательно"
          keyboardType="phone-pad"
          tabular
          big
          stacked
          live={!!draft}
          autoFocus={!!draft && draft.focus !== "name"}
          // Телефон — ключ дедупа (phone_e164 + UNIQUE-индекс). Стирание
          // номера у сохранённого клиента уносило и ключ: клиент становился
          // невидимым для защиты от дублей, и его можно было создать заново.
          // Пустое и неразбираемое значение не пишем.
          onSave={(v) => {
            if (draft) {
              draft.onPhoneChange(v);
              return;
            }
            const next = v.trim();
            // Разбираем номер кодом страны КОМПАНИИ: у греческой фирмы «99…»
            // без «+» — греческий номер, а не кипрский. Номер со своим «+»
            // уважается как есть.
            const e164 = next ? tryToE164(next, country) : null;
            // Молча отклонять нельзя: строка возвращала прежний номер, и
            // человек не понимал, почему правка «не сохранилась».
            if (!e164) {
              haptics.warning();
              toast(
                next
                  ? "Номер не распознан — проверьте код страны"
                  : "Телефон обязателен",
                "error",
              );
              return;
            }
            update({ phone: next, phone_e164: e164 });
          }}
          trailing={
            draft ? (
              draft.valid ? (
                <Check color={t.success} size={18} strokeWidth={2.5} />
              ) : null
            ) : (
              <PhoneChannelButton
                number={client.phone}
                telegramUsername={client.telegram_username}
                label="основной"
              />
            )
          }
        />

        {/* Слот черновика: дедуп «Похоже, такой уже есть» / ошибка создания.
          Стоит сразу под номером — там же, где его причина. */}
        {draft?.footer ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {draft.footer}
          </View>
        ) : null}

        {/* Дополнительные номера — здесь же, у основного: муж/жена, рабочий,
          WhatsApp на другом номере. Ярлык переключается тапом. */}
        {extras
          .filter((p) => p.id !== pending?.id)
          .map((p) => (
            <FieldRow
              key={p.id}
              label={p.label || "Другой"}
              value={formatPhoneAsYouType(p.number, country)}
              placeholder="Номер"
              separated
              keyboardType="phone-pad"
              tabular
              // Тот же вид И ТОТ ЖЕ РАЗМЕР, что у основного номера (владелец
              // 2026-08-06: «хочу, чтоб всё было одинакового размера»).
              big
              stacked
              // В ЧЕРНОВИКЕ — live: «Готово» читает черновик из замыкания, и
              // коммит по blur до него не долетал — второй номер просто не
              // сохранялся вместе с клиентом.
              live={!!draft}
              onLabelPress={() => {
                haptics.tap();
                setLabelFor(p);
              }}
              onSave={(v) => savePhone(p.id, v, !!draft)}
              // Крестика нет: номер убирают, стирая его. Кнопка связи снова
              // одна в хвосте строки — и промахнуться по ней (аудит
              // 2026-07-27: слоп крестика залезал на зелёную кнопку) больше
              // нечем.
              trailing={
                <PhoneChannelButton number={p.number} label={p.label} />
              }
            />
          ))}

        {/* Новый номер: то же поле, но ещё не в данных. Пустым уйдёт — исчезнет
          без следа, с цифрами — станет обычной строкой номера. */}
        {pending ? (
          <FieldRow
            label={pending.label}
            // Код страны компании подставлен заранее (владелец 2026-08-06:
            // «чтоб оно автоматически подтягивало +357… если надо исправить —
            // сотру и выберу другой»). Это ПОДСКАЗКА, а не значение: номер,
            // введённый со своим «+», уважается как есть.
            value={dialPrefix(country)}
            placeholder="Номер"
            separated
            keyboardType="phone-pad"
            tabular
            big
            stacked
            autoFocus
            // БЕЗ live: он писал PATCH на КАЖДЫЙ СИМВОЛ (восемь запросов на
            // восьмизначный номер). Коммит по blur / Return / уходу со строки
            // уже даёт примитив, а «Готово» на карточке снимает клавиатуру
            // перед сохранением — значит черновик успевает получить номер.
            onSave={commitPending}
            // Правка закончилась — номер уже в данных, и строка становится
            // обычной строкой-номером (с переключением подписи). Пустая
            // строка исчезает сама: отменять её крестиком нечего.
            onEditEnd={() => setPendingRow(null)}
          />
        ) : null}

        {/* Способы связи, которые не являются номером: Telegram, Instagram,
          WhatsApp на другом номере, почта. Стоят там же, где номера — это
          такой же контакт этого же человека. Строка есть, только если поле
          заполнено (или его сейчас заполняют): пустых полок не держим.
          Раньше за ними надо было уходить на страницу «Ещё» внизу карточки. */}
        {CONTACT_FIELDS.filter(
          (f) => f.display(client).trim().length > 0 || addingField === f.id,
        ).map((f) => {
          const saved = f.display(client);
          // Новая строка открывается СРАЗУ С ПРИСТАВКОЙ «@» (владелец
          // 2026-08-02: «как код страны +357 у телефона»): стереть можно, но
          // печатать её каждый раз не нужно.
          const shown = saved || (addingField === f.id ? (f.prefix ?? "") : "");
          const url = f.url(typing?.id === f.id ? typing.value : shown);
          return (
            <FieldRow
              key={f.id}
              label={f.label}
              value={shown}
              placeholder={f.placeholder}
              separated
              stacked
              keyboardType={f.keyboardType}
              autoCapitalize={f.autoCapitalize}
              tabular={f.id === "whatsapp"}
              autoFocus={addingField === f.id}
              onType={(v) => setTyping({ id: f.id, value: v })}
              onSave={(v) => update(f.patch(v))}
              onEditEnd={() => {
                setAddingField(null);
                setTyping(null);
              }}
              trailing={
                url ? (
                  <RowActionButton
                    icon={f.icon}
                    color={f.color}
                    label={`${f.label} · открыть`}
                    onPress={() => {
                      haptics.tap();
                      void Linking.openURL(url);
                    }}
                  />
                ) : null
              }
            />
          );
        })}

        {/* ОДИН ПЛЮС НА ВСЁ (владелец 2026-08-02): номер, WhatsApp, Telegram,
          Instagram, почта — выбираются в листе снизу, как метка или тег. */}
        <AddRow
          label="Добавить"
          separated
          onPress={() => {
            haptics.tap();
            setAddOpen(true);
          }}
        />

        <PickerSheet
          visible={labelFor !== null}
          title="Подпись номера"
          items={EXTRA_LABELS.map((label) => ({
            id: label,
            label,
            icon: LABEL_ICONS[label] ?? Phone,
            color: t.accent,
            onPress: () => {
              if (labelFor) patchPhone(labelFor.id, { label });
            },
          }))}
          onClose={() => setLabelFor(null)}
        />

        <AddContactSheet
          visible={addOpen}
          client={client}
          onPick={onPickAdd}
          onClose={() => setAddOpen(false)}
        />

      </RowGroup>

      {/* МАЛЕНЬКАЯ КАРТОЧКА ПОД НОМЕРОМ (владелец 2026-07-26). Не строки-
          факты, а сводка: долг первым и янтарём («обрати внимание», не
          авария), напоминание, и одной строкой доверие — визиты, сумма,
          когда был, когда записан. Отдельной карточкой, а не хвостом блока
          идентичности: это ПРОИЗВОДНОЕ, а не поле, которое правят.

          Она же — ВХОД В ИСТОРИЮ ЗАПИСЕЙ (владелец 2026-08-02). Отдельной
          строки «История записей · N» больше нет: она повторяла те же
          визиты числом, а место на карточке не бесконечное. */}
      {debt || badge || trustSegments.length > 0 ? (
        <Pressable
          onPress={
            onOpenHistory
              ? () => {
                  haptics.tap();
                  onOpenHistory();
                }
              : undefined
          }
          disabled={!onOpenHistory}
          accessibilityRole={onOpenHistory ? "button" : undefined}
          accessibilityLabel={
            onOpenHistory
              ? `История записей · ${trustSegments.map((s) => s.text).join(" · ")}`
              : undefined
          }
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginHorizontal: GUTTER,
            marginTop: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: t.radius.card,
            backgroundColor: pressed && onOpenHistory ? t.pressed : t.surface,
          })}
        >
          <View style={{ flex: 1, gap: 4 }}>
            {debt ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 15, fontWeight: "700", color: t.warning }}
              >
                {`Долг ${debt}`}
              </Text>
            ) : null}
            {badge ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Bell
                  color={badge.due ? t.danger : t.sub}
                  size={12}
                  strokeWidth={2.2}
                />
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 13,
                    fontWeight: badge.due ? "600" : "400",
                    color: badge.due ? t.danger : t.sub,
                  }}
                >
                  {`Напомнить · ${badge.label}`}
                </Text>
              </View>
            ) : null}
            {trustSegments.length > 0 ? (
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15 }}>
                {trustSegments.map((seg, i) => (
                  <Text key={seg.text}>
                    {i > 0 ? (
                      <Text style={{ color: t.faint, fontWeight: "400" }}>
                        {"  ·  "}
                      </Text>
                    ) : null}
                    <Text style={{ color: seg.color, fontWeight: seg.weight }}>
                      {seg.text}
                    </Text>
                  </Text>
                ))}
              </Text>
            ) : null}
          </View>
          {onOpenHistory ? (
            <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
          ) : null}
        </Pressable>
      ) : null}
    </>
  );
}
