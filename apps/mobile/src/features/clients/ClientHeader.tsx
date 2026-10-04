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

import type { ReactNode } from "react";
import { Check } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import {
  formatPhoneAsYouType,
  phoneParts,
  tryToE164,
} from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useCopyValue } from "@/lib/copy-value";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { ClientExtraContacts } from "@/features/clients/ClientExtraContacts";
import { usePhoneCountry } from "@/features/clients/use-phone-country";
import { contactsLocked } from "@/features/clients/member-contacts";
import { LockedPhoneRow } from "@/features/clients/LockedPhoneRow";
import { CONTACT_COLUMN } from "@/features/clients/contact-column";

/** Режим создания: то, что знает только композер экрана.
 *
 *  Имя и телефон здесь редактируются ЖИВО (onChangeText), а не по blur как
 *  в карточке: «Создать клиента» читает черновик из замыкания текущего рендера, и
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
  /** Возвращает false, если запись не удалась: писатель массива номеров по
   *  этому ответу ОТКАТЫВАЕТ оптимистичное значение. Подменённый `true`
   *  выключал откат, и неудачная правка тихо уезжала в базу со следующей
   *  удачной (найдено аудитом 2026-07-27). */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  draft?: ClientHeaderDraft;
  /** Чей это человек — строки «жена · Павел Иванов» сразу под именем, как
   *  должность и компания в Контактах iPhone (`MemberOfLine`). Строк бывает
   *  несколько: жилец двух вилл одной управляющей — это две связи. */
  memberOf?: ReactNode;
  /** ЛЮДИ КАРТОЧКИ со своей дверью — строки внутри ЭТОГО ЖЕ блока, ПОД
   *  «Добавить» (владелец 2026-09-21: «первый блок — клиент, туда входят
   *  люди, связи, компании… всё в один блок»). Собирает их страница: ей
   *  видно и право, и источник, и писатель связей. */
  people?: ReactNode;
  /** Заметка клиента — СРАЗУ ПОД блоком «Клиент» (владелец 23.09: «сначала
   *  идёт блок „Клиент", потом заметка клиента»), до «Людей». */
  note?: ReactNode;
  /** Нет права менять карточку — номера только читаются, двери нет. */
  readOnly?: boolean;
  /** Нельзя вынести клиента из приложения (сотрудник, владелец 30.09): ни
   *  копирования долгим нажатием, ни «Скопировать» в поле. По умолчанию —
   *  можно. */
  noCopy?: boolean;
}

export default function ClientHeader({
  client,
  update,
  draft,
  memberOf,
  people,
  note,
  readOnly,
  noCopy = false,
}: ClientHeaderProps) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry(client.team_id ?? null);
  const copy = useCopyValue();
  // Код страны отдельно, цифры отдельно — для строки «Телефон».
  const phone = phoneParts(client.phone, country);
  // Номер сотруднику ещё не открыт (30.09): на месте цифр — замок, правки
  // контактов нет, пока номер не открыт дверью.
  const locked = !draft && contactsLocked(client);
  // Новый клиент: страна номера — подписью над полем, цифры — в поле.
  const dial = usePhoneCountry({
    phone: client.phone,
    home: country,
    onChange: (full) => {
      if (draft) {
        draft.onPhoneChange(full);
        return;
      }
      // Карточка: страну сменили в шторке — номер переписывается тем же
      // путём, что правка строки (ключ дедупа вместе с ним).
      const e164 = full ? tryToE164(full, country) : null;
      if (!e164) {
        haptics.warning();
        toast("Номер не распознан — проверьте код страны", "error");
        return;
      }
      update({ phone: full, phone_e164: e164 });
    },
  });

  return (
    <>
      {/* БЛОК С ИМЕНЕМ «КЛИЕНТ» (владелец 22.09, вариант 2 из четырёх: «у нас
        есть блок люди, блок визиты… но нет блока на самой заглавной»). У
        каждого блока страницы своё имя — у первого тоже. */}
      <SectionCard title="Клиент">
        {/* Имя — ОБЯЗАТЕЛЬНОЕ (владелец 2026-07-26): безымянного клиента не
          найти ни поиском, ни глазами, и в SMS-шаблон нечего подставить.
          Человек это или компания — владелец не различает (2026-09-21: «в
          имя я буду вписывать компанию»): одно поле на обоих. */}
        <FieldRow
          noCopy={noCopy}
          // Карточку только видят (право «Карточки клиентов: Видит») — имя
          // не правится.
          readOnly={!draft && !!readOnly}
          // ОДНОЙ КОЛОНКОЙ С КОНТАКТАМИ (владелец 30.09: «если написал
          // „Телефон“ — слева имя, ниже телефон, как можно проще»): «Имя |
          // Артем», «Телефон | +357 …». Имя жирнее — это сам человек.
          label="Имя"
          column={CONTACT_COLUMN}
          big
          value={client.full_name}
          placeholder="Имя или компания"
          live={!!draft}
          // Вставку «Мария +357 99…» черновик делит: номер уезжает в телефон,
          // и поле должно сразу показать, что в имени осталось только имя.
          followValue={!!draft}
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

        {memberOf ?? null}

        {/* Телефон вторым (порядок владельца 2026-07-26: сначала имя).
          Ярлык сверху, значение по левому краю — печатать в правое
          выравнивание неудобно.

          ЯРЛЫКИ ЗДЕСЬ ПОКА ОСТАЮТСЯ. Попытка убрать их совсем и увести
          подпись вправо от номера (2026-08-06) сделала блок пустым и
          нечитаемым — владелец: «стало ещё хуже, просто номера и всё».
          Вид блока переосмысливается отдельно. */}
        {locked ? (
          <LockedPhoneRow client={client} />
        ) : (
        <FieldRow
          // СТРОКА «ТЕЛЕФОН» — ВАРИАНТ 10 ВЛАДЕЛЬЦА (30.09): подпись слева
          // колонкой, код страны тихим серым, цифры тёмные — «Телефон | +357
          // 97 469 998». Флагов нет («сдержанно, стильно»). В новом клиенте
          // код нажимается — выбор страны; печатают только цифры.
          label="Телефон"
          column={CONTACT_COLUMN}
          separated
          prefix={
            draft
              ? dial.value.trim().startsWith("+")
                ? undefined
                : dial.code
              : phone.code
          }
          // Код страны меняется тапом по нему — и в новом клиенте, и на
          // карточке (владелец 30.09: «а как менять код страны?»).
          onPrefixPress={draft || !readOnly ? dial.openPicker : undefined}
          value={draft ? dial.value : phone.rest}
          placeholder="Номер"
          keyboardType="phone-pad"
          tabular
          live={!!draft}
          readOnly={!draft && !!readOnly}
          autoFocus={!!draft && draft.focus !== "name"}
          // Долгое нажатие копирует номер — тем видом, каким он показан.
          // В черновике поле открыто для ввода, и нажатие принадлежит ему.
          onLongPress={
            !draft && !noCopy && client.phone.trim()
              ? () => copy(formatPhoneAsYouType(client.phone, country))
              : undefined
          }
          noCopy={noCopy}
          // Телефон — ключ дедупа (phone_e164 + UNIQUE-индекс). Стирание
          // номера у сохранённого клиента уносило и ключ: клиент становился
          // невидимым для защиты от дублей, и его можно было создать заново.
          // Пустое и неразбираемое значение не пишем.
          onSave={(v) => {
            if (draft) {
              dial.onType(v);
              return;
            }
            const typed = v.trim();
            // Печатают цифры без кода — код строки добавляется сам; свой «+»
            // уважается как есть.
            const next = typed ? (typed.startsWith("+") ? typed : `${phone.code} ${typed}`) : "";
            // Разбираем номер кодом страны КОМПАНИИ: у греческой фирмы «99…»
            // без «+» — греческий номер, а не кипрский.
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
                teamId={client.team_id ?? null}
              />
            )
          }
        />
        )}

        {/* Слот черновика: дедуп «Похоже, такой уже есть» / ошибка создания.
          Стоит сразу под номером — там же, где его причина. */}
        {/* Слот НЕ ОБЁРНУТ отступами: `ClientDraftNotice` возвращает null,
            пока дубля и ошибки нет, а обёртка с `paddingBottom: 8`
            рисовалась ВСЕГДА — под номером висела пустая полоса, и строка
            номера читалась выше строки имени (60 против 72 pt, замерено на
            симуляторе 2026-09-10). Отступы теперь несёт сама подсказка. */}
        {draft?.footer ?? null}

        <ClientExtraContacts
          client={client}
          update={update}
          draft={!!draft}
          teamId={client.team_id ?? null}
          compact
          column={CONTACT_COLUMN}
          readOnly={readOnly || locked}
          noCopy={noCopy}
        />
      </SectionCard>
      {dial.sheet}

      {/* ЛЮДИ — СВОИМ БЛОКОМ СРАЗУ ПОД КЛИЕНТОМ (владелец 22.09: «давай
          сделаем отдельным блоком добавления человека»). Пункт «Человек» в
          листе «Добавить» прятал дверь за вторым тапом: блок «Люди» с дверью
          «Добавить человека» — тот же язык, что «Объекты» и «Добавить объект». */}
      {note ?? null}
      {people ?? null}
    </>
  );
}
