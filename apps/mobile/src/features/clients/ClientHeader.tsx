// БЛОК ИДЕНТИЧНОСТИ клиента — одна вёрстка на просмотр и создание
// («одна страница»): имя, номер телефона, второй номер; объекты и прочее — в
// своих блоках, и всё всегда можно редактировать.
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

import { useEffect, type ReactNode } from "react";
import { Check } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import {
  formatPhoneAsYouType,
  tryToE164,
} from "@/lib/phone";
import { useDefaultCountry } from "@/features/reference/default-country";
import { FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { TourTarget } from "@/components/tour/TourTarget";
import { setTourReady } from "@/components/tour/tour-store";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useCopyValue } from "@/lib/copy-value";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { ClientExtraContacts } from "@/features/clients/ClientExtraContacts";
import { useDraftPhone, usePhoneField } from "@/features/clients/use-phone-country";
import { contactsLocked } from "@/session/member-contacts";
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
   *  удачной. */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  draft?: ClientHeaderDraft;
  /** Чей это человек — строки «жена · Павел Иванов» сразу под именем, как
   *  должность и компания в Контактах iPhone (`MemberOfLine`). Строк бывает
   *  несколько: жилец двух вилл одной управляющей — это две связи. */
  memberOf?: ReactNode;
  /** ЛЮДИ КАРТОЧКИ со своей дверью — строки внутри ЭТОГО ЖЕ блока, ПОД
   *  «Добавить» (в первый блок «Клиент» входят люди, связи, компании). Собирает их страница: ей
   *  видно и право, и источник, и писатель связей. */
  people?: ReactNode;
  /** Заметка клиента — СРАЗУ ПОД блоком «Клиент», до «Людей». */
  note?: ReactNode;
  /** Нет права менять карточку — номера только читаются, двери нет. */
  readOnly?: boolean;
  /** Нельзя вынести клиента из приложения (сотрудник): ни
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
  // Обучение ждёт имени: «Дальше» на шаге «имя клиента» горит, когда оно есть.
  const draftNamed = !!draft && !!client.full_name?.trim();
  useEffect(() => {
    if (draft) setTourReady("client-name", draftNamed);
  }, [draft, draftNamed]);
  const country = useDefaultCountry(client.team_id ?? null);
  const copy = useCopyValue();
  // Номер сотруднику ещё не открыт: на месте цифр — замок, правки
  // контактов нет, пока номер не открыт дверью.
  const locked = !draft && contactsLocked(client);
  // Новый клиент: поле рождается с кодом страны команды, номер — живьём в
  // черновик. Карточка: весь номер с кодом в поле, правка — по уходу.
  const draftPhone = useDraftPhone({
    phone: client.phone,
    home: country,
    onChange: (full) => draft?.onPhoneChange(full),
  });
  const savedPhone = usePhoneField({
    phone: client.phone,
    home: country,
    // Телефон — ключ дедупа (phone_e164 + UNIQUE-индекс), но НЕОБЯЗАТЕЛЕН:
    // стёртый номер сохраняется пустым. Неразбираемое значение не пишем.
    onSave: (next) => {
      if (!next) {
        update({ phone: "", phone_e164: null });
        return;
      }
      // Номер без «+» разбирается кодом страны КОМПАНИИ: у греческой фирмы
      // «99…» — греческий номер, а не кипрский.
      const e164 = tryToE164(next, country);
      // Молча отклонять нельзя: строка возвращала прежний номер, и человек
      // не понимал, почему правка «не сохранилась».
      if (!e164) {
        haptics.warning();
        toast("Номер не распознан — проверьте код страны", "error");
        return;
      }
      update({ phone: next, phone_e164: e164 });
    },
  });

  return (
    <>
      {/* БЛОК С ИМЕНЕМ «КЛИЕНТ»: у блоков «Люди», «История» есть шапка, значит
        и у самого главного блока она нужна. У
        каждого блока страницы своё имя — у первого тоже. */}
      <SectionCard title="Клиент">
        {/* Имя — ОБЯЗАТЕЛЬНОЕ: безымянного клиента не найти ни поиском, ни
          глазами, и в SMS-шаблон нечего подставить. Человек это или компания —
          не различаем: одно поле на обоих. */}
        <TourTarget id="client.name">
        <FieldRow
          noCopy={noCopy}
          // Карточку только видят (право «Карточки клиентов: Видит») — имя
          // не правится.
          readOnly={!draft && !!readOnly}
          // ОДНОЙ КОЛОНКОЙ С КОНТАКТАМИ: «Имя |
          // Артем», «Телефон | +357 …». Имя жирнее — это сам человек.
          label="Имя"
          column={CONTACT_COLUMN}
          big
          value={client.full_name}
          placeholder="Имя или компания"
          // Имя и название компании — с заглавной у каждого слова.
          autoCapitalize="words"
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
        </TourTarget>

        {memberOf ?? null}

        {/* Телефон вторым (сначала имя).
          Ярлык сверху, значение по левому краю — печатать в правое
          выравнивание неудобно.

          ЯРЛЫКИ ОСТАЮТСЯ: без подписи, уведённой вправо от номера, блок
          пустой и нечитаемый — просто номера и всё. */}
        {locked ? (
          <LockedPhoneRow client={client} />
        ) : (
        <TourTarget id="client.phone">
        <FieldRow
          // СТРОКА «ТЕЛЕФОН»: подпись слева
          // колонкой — «Телефон | +357 97 469 998». Флагов нет
          // («сдержанно, стильно»).
          label="Телефон"
          column={CONTACT_COLUMN}
          separated
          // КОД СТРАНЫ — В САМОМ ПОЛЕ (писать код страны, выбирать не
          // нужно): «+357 97 469 998» целиком; пустое поле
          // начинается с кода страны команды.
          value={draft ? draftPhone.value : savedPhone.value}
          seed={savedPhone.seed}
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
          // Телефон — ключ дедупа (phone_e164 + UNIQUE-индекс), но
          // НЕОБЯЗАТЕЛЕН: стёртый номер сохраняется пустым. Неразбираемое
          // значение не пишем.
          onSave={draft ? draftPhone.onType : savedPhone.onSave}
          trailing={
            draft ? (
              draft.valid ? (
                <Check color={t.success} size={18} strokeWidth={2.5} />
              ) : null
            ) : (
              <PhoneChannelButton
                number={client.phone}
                telegramUsername={client.telegram_username}
                instagramUsername={client.instagram_username}
                label="основной"
                teamId={client.team_id ?? null}
              />
            )
          }
        />
        </TourTarget>
        )}

        {/* Слот черновика: дедуп «Похоже, такой уже есть» / ошибка создания.
          Стоит сразу под номером — там же, где его причина. */}
        {/* Слот НЕ ОБЁРНУТ отступами: `ClientDraftNotice` возвращает null,
            пока дубля и ошибки нет, а обёртка с `paddingBottom: 8`
            рисовалась ВСЕГДА — под номером висела пустая полоса, и строка
            номера читалась выше строки имени (60 против 72 pt). Отступы теперь несёт сама подсказка. */}
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

      {/* ЛЮДИ — СВОИМ БЛОКОМ СРАЗУ ПОД КЛИЕНТОМ. Пункт «Человек» в
          листе «Добавить» прятал дверь за вторым тапом: блок «Люди» с дверью
          «Добавить человека» — тот же язык, что «Объекты» и «Добавить объект». */}
      {note ?? null}
      {people ?? null}
    </>
  );
}
