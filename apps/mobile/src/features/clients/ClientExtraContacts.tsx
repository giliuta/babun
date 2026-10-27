import { useRef, useState } from "react";
import {
  Briefcase,
  Home,
  MessageCircle,
  Phone,
  Smartphone,
  type LucideIcon,
} from "lucide-react-native";
import type { PhoneEntry } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { withHomeCode } from "@/features/clients/use-phone-country";
import {
  dialPrefix,
  formatPhoneAsYouType,
  formatPhoneForDisplay,
  isDialOnly,
} from "@/lib/phone";
import { useDefaultCountry } from "@/features/reference/default-country";
import { FieldRow } from "@/components/ui/card-rows";
import {
  AddContactSheet,
  type AddContactChoice,
} from "@/features/clients/AddContactSheet";
import {
  type ContactFieldId,
  type ContactHolder,
} from "@/features/clients/contact-fields";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { useCopyValue } from "@/lib/copy-value";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { ContactFieldRows } from "@/features/clients/extra-contacts/ContactFieldRows";
import { EXTRA_LABELS, extraLabelText, nextExtraLabel } from "@/features/clients/extra-contacts/extra-labels";
import { useExtraPhoneFinish, useExtraPhoneTaken } from "@/features/clients/extra-contacts/use-extra-phone-taken";

// ДОПОЛНИТЕЛЬНЫЕ КОНТАКТЫ КЛИЕНТА — строки блока идентичности под главным
// номером: ещё номера (`client.phones`), мессенджеры и почта, и один плюс на
// всё. Стоят в той же группе, что имя и телефон, — второй номер нужен там же,
// где первый.
//
// Вынесены из `ClientHeader` (STORY-085), чтобы шапка не перевалила за
// лимит строк.

/** Стабильная пустая ссылка: `?? []` давал новый массив на каждый рендер и
 *  дёргал пересинхронизацию писателя. */
const EMPTY_PHONES: PhoneEntry[] = [];

/** Значок подписи — тот же язык, что у остальных листов продукта; порядок —
 *  `EXTRA_LABELS` (ключи там защищены от перевода, здесь — нет). */
const LABEL_ICONS: LucideIcon[] = [Smartphone, Briefcase, Home, MessageCircle, Phone];

export function ClientExtraContacts({
  client,
  update,
  draft,
  readOnly = false,
  noCopy = false,
  compact = false,
  inline = false,
  teamId = null,
  column,
}: {
  /** Подпись слева колонкой (блок «Клиент»): номера —
   *  «Телефон 2», «Телефон 3» без ролей (роли — блок «Люди»), код страны
   *  тихим серым, мессенджеры — тем же видом. */
  column?: number;
  client: ContactHolder;
  /** Возвращает false, если запись не удалась: писатель массива номеров по
   *  этому ответу ОТКАТЫВАЕТ оптимистичное значение. */
  update: (patch: Partial<ContactHolder>) => Promise<boolean> | void;
  /** Режим создания: строки пишут на каждый символ (см. `ClientHeaderDraft`). */
  draft: boolean;
  /** Только смотреть: сотрудник без права менять контакты. Строки читаются,
   *  «Добавить» нет — дверь, за которой сервер откажет, не рисуется. */
  readOnly?: boolean;
  /** Без копирования номеров и ников: сотрудник видит клиента, но вынести
   *  его не может. */
  noCopy?: boolean;
  /** Плотные строки — блоки клиента и его людей. */
  compact?: boolean;
  /** Подпись слева, номер справа — строки страницы сотрудника. */
  inline?: boolean;
  /** Команда клиента — её «Способы связи» (у каждой команды свои). */
  teamId?: string | null;
}) {
  const t = useThemeColors();
  const country = useDefaultCountry(teamId);
  const copy = useCopyValue();
  // У строк сотрудника (`EmployeeIdentityBlock`) id клиента нет — тогда
  // сверяется со всеми клиентами.
  const ownId = "id" in client ? (client as { id?: string }).id : undefined;
  const warnIfTaken = useExtraPhoneTaken(ownId, country);

  const extras = client.phones ?? EMPTY_PHONES;
  // Номера — тот же jsonb-массив, что объекты: писать его можно только из
  // свежайшего значения и по очереди, иначе две быстрые правки затирают друг
  // друга (patchPhone из снимка рендера + PATCH на всю колонку).
  const phones = useJsonArrayWriter<PhoneEntry>(extras, (next) =>
    Promise.resolve(update({ phones: next })).then((ok) => ok !== false),
  );
  const finishRow = useExtraPhoneFinish(phones, ownId, country);

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
    const empty = isDialOnly(value, country);
    void phones.apply((all) => {
      const rest = all.filter((p) => p.id !== id);
      // Пустое поле записью не становится, а уже созданную стирает: строки
      // «WHATSAPP — Номер» без номера в данных быть не должно. Один код
      // страны — тоже пусто: это подставленная подсказка, а не номер.
      return empty ? rest : [...rest, { id, number: value, label }];
    });
  };
  /** Набор кончился — номер в общем виде и проверка дубля (см. хук). */
  const finishPending = () => {
    const row = pendingRef.current;
    setPendingRow(null);
    if (row) finishRow(row.id);
  };
  const patchPhone = (id: string, patch: Partial<PhoneEntry>) =>
    void phones.apply((all) =>
      all.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  /** Правка номера. СТЁРТЫЙ номер = убранный номер (удаляется автоматически,
   *  если там ничего не написано). Тот же закон, что у новой строки: поле без цифр записью не
   *  является, и строки «МОБИЛЬНЫЙ — Номер» без номера в данных не остаётся. */
  const savePhone = (id: string, raw: string, live: boolean) => {
    const value = raw.trim();
    if (!isDialOnly(value, country)) {
      // В черновике строка пишется на каждый символ — формат там держит
      // само поле; на уходе с поля номер ложится в общем виде.
      patchPhone(id, { number: live ? value : formatPhoneAsYouType(value, country) });
      if (!live) warnIfTaken(value);
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
        .map((p, index) => {
          if (column !== undefined) {
            return (
              <FieldRow
                noCopy={noCopy}
                key={p.id}
                // БЕЗ РОЛЕЙ («жена» — это люди, отдельный блок): подпись — порядковый номер, роль в данных не
                // трогаем и не показываем.
                label={`Телефон ${index + 2}`}
                column={column}
                // Код страны — в самом поле: пустое
                // начинается с кода команды, стирают и вписывают свой.
                value={formatPhoneForDisplay(p.number, country)}
                seed={dialPrefix(country)}
                placeholder="Номер"
                separated
                keyboardType="phone-pad"
                tabular
                live={draft}
                readOnly={readOnly}
                onSave={(v) => savePhone(p.id, withHomeCode(v, country), draft)}
                onLongPress={
                  !draft && !noCopy && p.number.trim()
                    ? () => copy(formatPhoneAsYouType(p.number, country))
                    : undefined
                }
                trailing={<PhoneChannelButton number={p.number} teamId={teamId} />}
              />
            );
          }
          return (
          <FieldRow
            noCopy={noCopy}
            key={p.id}
            label={extraLabelText(p.label)}
            value={
              draft
                ? formatPhoneAsYouType(p.number, country)
                : formatPhoneForDisplay(p.number, country)
            }
            placeholder="Номер"
            separated
            keyboardType="phone-pad"
            tabular
            // Тот же вид И ТОТ ЖЕ РАЗМЕР, что у основного номера.
            big={!inline}
            stacked={!inline}
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
              !draft && !noCopy && p.number.trim()
                ? () => copy(formatPhoneAsYouType(p.number, country))
                : undefined
            }
            // Крестика нет: номер убирают, стирая его. Кнопка связи снова
            // одна в хвосте строки — и промахнуться по ней (слоп крестика
            // залезал бы на зелёную кнопку) нечем.
            trailing={
              <PhoneChannelButton
                number={p.number}
                label={extraLabelText(p.label)}
                teamId={teamId}
              />
            }
          />
          );
        })}

      {/* Новый номер: то же поле, но ещё не в данных. Пустым уйдёт — исчезнет
        без следа, с цифрами — станет обычной строкой номера. */}
      {pending && column !== undefined ? (
        <FieldRow
          noCopy={noCopy}
          label={`Телефон ${extras.filter((p) => p.id !== pending.id).length + 2}`}
          column={column}
          value=""
          seed={dialPrefix(country)}
          placeholder="Номер"
          separated
          keyboardType="phone-pad"
          tabular
          autoFocus
          live={draft}
          onSave={(v) => commitPending(withHomeCode(v, country))}
          onEditEnd={finishPending}
        />
      ) : pending ? (
        <FieldRow
            noCopy={noCopy}
          label={extraLabelText(pending.label)}
          // Код страны компании подставлен заранее (+357…): если надо
          // исправить — стирают и вписывают другой. Это ПОДСКАЗКА, а не значение: номер,
          // введённый со своим «+», уважается как есть.
          value={dialPrefix(country)}
          placeholder="Номер"
          separated
          keyboardType="phone-pad"
          tabular
          big={!inline}
          stacked={!inline}
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
          onEditEnd={finishPending}
        />
      ) : null}

      {/* Messengers and email: see `extra-contacts/ContactFieldRows`. */}
      <ContactFieldRows
        client={client}
        update={update}
        country={country}
        column={column}
        addingField={addingField}
        setAddingField={setAddingField}
        typing={typing}
        setTyping={setTyping}
        readOnly={readOnly}
        noCopy={noCopy}
        compact={compact}
        inline={inline}
        live={draft}
      />

      {/* ОДИН ПЛЮС НА ВСЁ: номер, WhatsApp, Telegram,
        Instagram, почта — выбираются в листе снизу, как метка или тег.
        Людей здесь нет: у них свой блок «Люди». */}
      {readOnly ? null : (
        // ДВЕРЬ СО ЗНАЧКОМ, как «Добавить человека» и «Добавить объект»
        // (иконка «добавить номер», открывается шторка). Голое слово было бы
        // единственной дверью страницы без значка.
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
          label: extraLabelText(label),
          icon: LABEL_ICONS[EXTRA_LABELS.indexOf(label)] ?? Phone,
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
        teamId={teamId}
        onPick={onPickAdd}
        onClose={() => setAddOpen(false)}
      />
    </>
  );
}
