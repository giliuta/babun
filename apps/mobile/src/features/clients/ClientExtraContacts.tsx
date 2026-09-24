import { useRef, useState } from "react";
import { Linking } from "react-native";
import {
  Briefcase,
  Home,
  MessageCircle,
  Phone,
  Smartphone,
  type LucideIcon,
} from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import {
  dialPrefix,
  formatPhoneAsYouType,
  formatPhoneForDisplay,
  isDialOnly,
} from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { FieldRow, RowActionButton } from "@/components/ui/card-rows";
import {
  AddContactSheet,
  type AddContactChoice,
} from "@/features/clients/AddContactSheet";
import {
  CONTACT_FIELDS,
  type ContactFieldId,
} from "@/features/clients/contact-fields";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { useCopyValue } from "@/lib/copy-value";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";

// ДОПОЛНИТЕЛЬНЫЕ КОНТАКТЫ КЛИЕНТА — строки блока идентичности под главным
// номером: ещё номера (`client.phones`), мессенджеры и почта, и один плюс на
// всё. Стоят в той же группе, что имя и телефон, — второй номер нужен там же,
// где первый.
//
// Жили внутри `ClientHeader`; вынесены 2026-09-21 (STORY-085), когда шапка
// перевалила за 650 строк. Поведение перенесено как было.

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

export function ClientExtraContacts({
  client,
  update,
  draft,
  readOnly = false,
  compact = false,
}: {
  client: Client;
  /** Возвращает false, если запись не удалась: писатель массива номеров по
   *  этому ответу ОТКАТЫВАЕТ оптимистичное значение. */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Режим создания: строки пишут на каждый символ (см. `ClientHeaderDraft`). */
  draft: boolean;
  /** Только смотреть: сотрудник без права менять контакты. Строки читаются,
   *  «Добавить» нет — дверь, за которой сервер откажет, не рисуется. */
  readOnly?: boolean;
  /** Плотные строки — блоки клиента и его людей (владелец 2026-09-21). */
  compact?: boolean;
}) {
  const t = useThemeColors();
  const country = useDefaultCountry();
  const copy = useCopyValue();

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

  return (
    <>
      {/* Дополнительные номера — здесь же, у основного: муж/жена, рабочий,
        WhatsApp на другом номере. Ярлык переключается тапом. */}
      {extras
        .filter((p) => p.id !== pending?.id)
        .map((p) => (
          <FieldRow
            key={p.id}
            label={p.label || "Другой"}
            value={
              draft
                ? formatPhoneAsYouType(p.number, country)
                : formatPhoneForDisplay(p.number, country)
            }
            placeholder="Номер"
            separated
            keyboardType="phone-pad"
            tabular
            // Тот же вид И ТОТ ЖЕ РАЗМЕР, что у основного номера (владелец
            // 2026-08-06: «хочу, чтоб всё было одинакового размера»).
            big
            stacked
            compact={compact}
            // В ЧЕРНОВИКЕ — live: «Готово» читает черновик из замыкания, и
            // коммит по blur до него не долетал — второй номер просто не
            // сохранялся вместе с клиентом.
            live={draft}
            readOnly={readOnly}
            onLabelPress={
              readOnly
                ? undefined
                : () => {
                    haptics.tap();
                    setLabelFor(p);
                  }
            }
            onSave={(v) => savePhone(p.id, v, draft)}
            // Долгое нажатие копирует номер, как у основного (в черновике
            // поле открыто для ввода — там нажатие принадлежит ему).
            onLongPress={
              !draft && p.number.trim()
                ? () => copy(formatPhoneAsYouType(p.number, country))
                : undefined
            }
            // Крестика нет: номер убирают, стирая его. Кнопка связи снова
            // одна в хвосте строки — и промахнуться по ней (аудит
            // 2026-07-27: слоп крестика залезал на зелёную кнопку) больше
            // нечем.
            trailing={<PhoneChannelButton number={p.number} label={p.label} />}
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
          compact={compact}
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
            compact={compact}
            keyboardType={f.keyboardType}
            autoCapitalize={f.autoCapitalize}
            tabular={f.id === "whatsapp"}
            readOnly={readOnly}
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
        Instagram, почта — выбираются в листе снизу, как метка или тег.
        Людей здесь нет: у них свой блок «Люди» (владелец 22.09). */}
      {readOnly ? null : (
        // ДВЕРЬ СО ЗНАЧКОМ, как «Добавить человека» и «Добавить объект»
        // (владелец 22.09 по варианту 2: «кнопка добавить — иконка добавить
        // номер, открывается шторка»). Голое слово было единственной дверью
        // страницы без значка.
        <ChooseRow
          compact
          icon={Phone}
          label="Добавить контакт"
          onPress={() => {
            haptics.tap();
            setAddOpen(true);
          }}
        />
      )}


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
    </>
  );
}
