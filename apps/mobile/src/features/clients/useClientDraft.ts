import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useCreateClient, useUpdateClientById } from "@/features/clients/queries";
import { splitSourceStep, type SplitRef } from "@/features/clients/split-client";
import { notify } from "@/lib/notify";
import { useClientsScopeOrNull } from "@/session/company-scope";
import { clientCardHref } from "@/session/clients-company";
import {
  countryDialCode,
  formatPhoneAsYouType,
  isDialOnly,
  tryToE164,
} from "@/lib/phone";
import { useDefaultCountry } from "@/features/reference/default-country";
import { splitNameAndPhone } from "@/features/clients/name-phone-paste";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { haptics } from "@/lib/haptics";
import { deliverCreatedClient } from "@/features/appointments/pending-client";
import { friendlyCreateError, isPhoneTakenError } from "@/features/clients/client-create-errors";
import { clientMembersQueryKey } from "@/features/clients/use-link-writer";
import { clientKeys } from "@/lib/client-query-keys";
import {
  draftCanSave,
  draftHasInput,
  draftPhoneTyped,
  type DraftOpen,
} from "@/features/clients/useClientDraft/core";
import { useDraftDuplicate } from "@/features/clients/useClientDraft/duplicate";
import type { ClientDraftOptions } from "@/features/clients/useClientDraft/options";
import { useNewClientTeam } from "@/features/clients/useClientDraft/team";
import { useBusinessToday } from "@/features/settings/business-today";

// The draft gate and route params are a pure core in `./useClientDraft/core`
// (a guard test loads it standalone); dedupe and team pick are hooks there.
export {
  draftCanSave,
  draftHasInput,
  draftLinkFromParams,
  draftLinkParams,
  draftPhoneTyped,
  type DraftGate,
  type DraftLinkParams,
  type DraftOpen,
} from "@/features/clients/useClientDraft/core";
export type { ClientDraftOptions };

export function useClientDraft(
  active: boolean,
  { forBooking = false, name, phone, link, split, team }: ClientDraftOptions = {},
) {
  const router = useRouter();
  const qc = useQueryClient();
  const activeTenantId = useTenantId();
  // Черновик заводит клиента В КОМПАНИЮ ИСТОЧНИКА: во вкладке это своя
  // компания (даже когда в календаре открыта чужая), из записи — компания
  // календаря (там источника нет, и берётся активная).
  const scope = useClientsScopeOrNull();
  const tenantId = scope?.tenantId ?? activeTenantId;
  const draftClient =
    scope && !scope.isActive ? tenantBoundClient(scope.tenantId) : supabase;
  const create = useCreateClient();
  const updateById = useUpdateClientById();
  const newClientTeam = useNewClientTeam(tenantId, team);
  // Код страны берём из профиля КОМПАНИИ (tenants.country), а не из константы
  // продукта: у кипрской фирмы поле открывается с «+357», у греческой — с
  // «+30». Номер, введённый со своим «+», всё равно уважается как есть.
  const country = useDefaultCountry(newClientTeam);
  const dial = countryDialCode(country);
  const businessToday = useBusinessToday();
  const [draft, setDraft] = useState<Client>(() =>
    createBlankClient({
      full_name: name?.trim() ?? "",
      first_contact_date: businessToday,
      // КОМАНДА — С ПЕРВОГО КАДРА, если она уже известна. Поле номера,
      // открытое сразу с фокусом (имя пришло из записи), берёт код страны на
      // первом кадре и потом его не меняет: команда, дописанная эффектом
      // ниже, приходила поздно, и греческая команда видела «+357».
      ...(newClientTeam ? { team_id: newClientTeam } : {}),
      // ПУСТО, А НЕ «+357 »: код страны стоит ПОДПИСЬЮ над полем
      // (`use-phone-country.tsx`), и продублированный в значении он мешал бы —
      // после смены страны в поле оставался бы прежний код.
      phone: phone?.trim() ? formatPhoneAsYouType(phone.trim(), country) : "",
      // Та же одна форма связи, что пишет писатель (`use-link-writer.ts`):
      // три ключа, «места нет» — это `null`.
      memberships: link?.groupId
        ? [
            {
              group_id: link.groupId,
              role: link.role.trim(),
              location_id: link.locationId ?? null,
            },
          ]
        : [],
    }),
  );
  // КОМАНДА ЧЕРНОВИКА ВИДНА СТРАНИЦЕ СРАЗУ: подпись страны над
  // номером читает `client.team_id`, и у черновика без неё код брался от
  // пояса компании, а не команды, куда клиент уйдёт. Выбранную руками
  // команду не трогаем — только ту, что поставили сами.
  const autoTeam = useRef<string | null>(newClientTeam ?? null);
  useEffect(() => {
    if (!active || !newClientTeam) return;
    const previous = autoTeam.current;
    autoTeam.current = newClientTeam;
    setDraft((current) =>
      (!current.team_id || current.team_id === previous) &&
      current.team_id !== newClientTeam
        ? { ...current, team_id: newClientTeam }
        : current,
    );
  }, [active, newClientTeam]);
  // Свежий черновик для `save`: замыкание нажатия видит состояние до записи
  // поля, которое дописалось при снятии фокуса.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [createError, setCreateError] = useState<string | null>(null);
  const e164 = active ? tryToE164(draft.phone.trim(), country) : null;
  const { duplicate, setDuplicate, findDuplicate, checkedFor } = useDraftDuplicate({
    active,
    e164,
    tenantId,
    scopeKind: scope?.kind,
    draftClient,
    bookingTeam: forBooking ? (team ?? null) : null, // из записи дубль — тот, кого ищут
  });
  // Засов «идёт создание» — синхронный, в отличие от create.isPending.
  const savingRef = useRef(false);

  const updateDraft = (patch: Partial<Client>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const onPhoneChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      phone:
        value.length < current.phone.length
          ? value
          : formatPhoneAsYouType(value, country),
    }));
    setDuplicate(null);
    setCreateError(null);
  };

  /** Живой ввод имени. Вставили контакт целиком («Мария +357 99 123456») —
   *  номер уходит в поле телефона, если там ещё только код страны; в имени
   *  остаётся имя. Набранный номер не перетирается: тогда вставка — просто
   *  текст имени, и человек сам решит, что с ним делать. */
  const onNameChange = (value: string) => {
    const split = splitNameAndPhone(value, country);
    // Номер уезжает только в ПУСТОЙ телефон (в поле один код страны).
    // Проверка повторена и внутри обновления: оно читает свежий черновик.
    if (!split || draftPhoneTyped(draft.phone, dial)) {
      updateDraft({ full_name: value });
      return;
    }
    setDraft((current) =>
      draftPhoneTyped(current.phone, dial)
        ? { ...current, full_name: value }
        : { ...current, full_name: split.name, phone: split.phone },
    );
    // Новый номер — новый ключ дедупа: его проверит эффект по `e164`.
    setDuplicate(null);
    setCreateError(null);
  };


  const isDirty = useMemo(
    () => active && draftHasInput(draft, dial),
    [active, draft, dial],
  );

  // Телефон ОБЯЗАТЕЛЕН и УНИКАЛЕН. Уникальность
  // держится на ключе phone_e164, поэтому «5+ цифр» больше не пропуск —
  // без разбираемого номера канонического ключа нет, а значит и дубль
  // ловить нечем. Разбор чисто локальный, офлайну не мешает.
  // Имя НЕ уникально (тёзок сколько угодно, дедуп только по номеру), но
  // ОБЯЗАТЕЛЬНО: безымянный клиент не находится ни
  // поиском, ни глазами в списке, а в SMS-шаблон подставлять нечего.
  // Исключение одно — клиент СО СВЯЗЬЮ, по одному имени (`draftCanSave`).
  const nameFilled = draft.full_name.trim().length > 0;
  const linked = (draft.memberships?.length ?? 0) > 0;
  const phoneTyped = draftPhoneTyped(draft.phone, dial);
  // Дубль найден — сохранять НЕЧЕГО: два клиента на одном номере невозможны
  // (правило продукта), и save() при дубле молча выходил. Кнопка при этом
  // оставалась яркой и активной: тап давал вибрацию и ничего больше. Гасим её
  // здесь, а баннер под номером говорит, что делать.
  const canSave = draftCanSave({
    active,
    nameFilled,
    e164,
    phoneTyped,
    linked,
    duplicate: duplicate !== null,
    saving: create.isPending,
  });

  /** СПЛИТ: вынесенный номер уходит из исходной карточки. Зовётся ТОЛЬКО
   *  после создания: не создался клиент — номер обязан остаться, где был.
   *
   *  Патч собирается из СВЕЖЕЙ строки кэша (`["client", id]` — её держит
   *  открытая под черновиком карточка), а не из замыкания: пока заполняли
   *  черновик, в исходной могли поправить другие номера. Строки в кэше нет
   *  или запись не прошла — номер живёт в обеих карточках, это не потеря,
   *  и человеку говорится словами, что убрать его надо руками. */
  const dropSplitPhone = async (ref: SplitRef, createdKey: string | null) => {
    const fresh = qc
      .getQueriesData<Client | null>({ queryKey: clientKeys.card(ref.sourceId) })
      .map(([, row]) => row)
      .find((row): row is Client => !!row);
    const step = fresh
      ? splitSourceStep(fresh, ref.phoneId, createdKey, (n) => tryToE164(n, country))
      : null;
    if (step?.kind === "gone" || step?.kind === "changed") return;
    try {
      if (!step) throw new Error("исходной карточки нет в кэше");
      await updateById.mutateAsync({ id: ref.sourceId, patch: step.patch });
    } catch {
      haptics.warning();
      notify("Номер остался и в исходной карточке — уберите его там вручную");
    }
  };

  /** Возвращает id созданного клиента — карточке это нужно, чтобы после
   *  сохранения открыть страницу объекта: она живёт отдельным роутом и
   *  несохранённого черновика не видит. null = не создали (гейт, дубль,
   *  ошибка), и тогда никакой навигации быть не должно. */
  const save = async (
    opts: {
      /** Что открыть на карточке сразу после создания. `person` — шторку
       *  «Кто это»: пункт «Человек» в новом клиенте сперва заводит его самого
       *  (связь живёт у человека и указывает на id карточки, которого у
       *  черновика ещё нет), а потом сразу спрашивает, кого привязать. */
      open?: DraftOpen;
    } = {},
  ): Promise<string | null> => {
    // Между тапом и появлением create.isPending есть незакрытое окно: сетевая
    // перепроверка дубля. Кнопка в нём активна и молчит, поэтому второй тап
    // запускал ВТОРОЕ создание — два клиента с одним номером. Засов ставим
    // синхронно, до первого await.
    if (!canSave || savingRef.current) return null;
    savingRef.current = true;
    setCreateError(null);
    // ПОЛЕ ПОД ПАЛЬЦЕМ ДОПИСЫВАЕТ СЕБЯ ПРИ УХОДЕ С НЕГО («Обращение», почта,
    // новый номер). Тап по «Создать клиента» с открытой клавиатурой отдавал
    // в базу черновик ДО этой записи — последнее набранное поле молча
    // терялось. Снимаем фокус, даём кадр на запись и читаем
    // черновик свежим — из ссылки, а не из замыкания этого нажатия.
    Keyboard.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const d = draftRef.current;

    // Дебаунс мог не успеть к быстрому тапу — тогда перепроверяем перед
    // записью. Успел для этого же номера — ответ уже есть, в сеть не ходим.
    if (e164 && !duplicate && tenantId && checkedFor.current !== e164) {
      const existing = await findDuplicate(e164);
      if (existing) {
        haptics.warning();
        setDuplicate(existing);
        savingRef.current = false;
        return null;
      }
    }
    // Дубль уже найден дебаунсом — создать нельзя. Второй тап не пропускает
    // «другого человека на том же номере»: два клиента на одном номере
    // невозможны.
    if (duplicate) {
      haptics.warning();
      savingRef.current = false;
      return null;
    }

    try {
      const created = await create.mutateAsync({
        ...d,
        team_id: d.team_id ?? newClientTeam,
        // Без разобранного номера гейт пропускает только пустое поле (клиент
        // со связью) — в нём один код страны, и в базу он уезжает пустым,
        // а не номером «+357».
        phone: e164 ? d.phone.trim() : "",
        // Стёртый номер «Телефона 2» в черновике хранится (`savePhone`, чтобы
        // перенабор не терял строку), а при создании отсеивается — иначе
        // карточка рождалась с пустой строкой «Телефон 2 | +357 | Номер».
        phones: d.phones.filter((p) => !isDialOnly(p.number ?? "", country)),
        full_name: d.full_name.trim(),
        phone_e164: e164,
        // Черновик пишет реквизиты как набраны (обрезка под пальцем съедала
        // пробелы) — чистим здесь; пустое — это «нет».
        legal_name: d.legal_name?.trim() || null,
        vat_number: d.vat_number?.trim() || null,
        reg_number: d.reg_number?.trim() || null,
        billing_address: d.billing_address?.trim() || null,
      });
      haptics.success();
      // Связь уехала вместе с клиентом, но блок людей карточки-группы кормит
      // СВОЙ ключ (`client-members`), а создание сбрасывает только список:
      // без этого Иван не появился бы у Натальи до следующего чтения.
      const groupIds = (d.memberships ?? []).map((m) => m.group_id);
      for (const groupId of groupIds) {
        void qc.invalidateQueries({ queryKey: clientMembersQueryKey(tenantId, groupId) });
      }
      // Сплит: клиент уже в базе — теперь номер уходит из исходной. Ждём
      // записи до возврата: иначе на карточке Павла на миг стоял бы номер,
      // который только что стал Марией.
      if (split) await dropSplitPhone(split, e164);
      // КЛИЕНТ, ЗАВЕДЁННЫЙ РАДИ ЗАПИСИ, ВОЗВРАЩАЕТСЯ В ЗАПИСЬ: «Готово» не
      // оставляет на странице клиента, а сразу переходит в запись.
      //
      // Карточка открыта ПОВЕРХ записи (`/book/client`, см. pending-client.ts):
      // запись стоит в стеке прямо под нами со всем набранным, поэтому
      // хватает отдать ей id и уйти «назад». Прежний путь — переоткрыть
      // запись со слотом из ящика — терял услуги и заметку, набранные до
      // похода за клиентом.
      if (forBooking) {
        deliverCreatedClient(created.id);
        if (router.canGoBack()) router.back();
        else router.replace("/book");
        return created.id;
      }
      // ЧЕРНОВИК СО СВЯЗЬЮ ВОЗВРАЩАЕТСЯ ТУДА, ГДЕ ЕГО ЗАВЕЛИ (ТЗ, сценарий г-б).
      // Дверь «Добавить жильца» стоит на карточке Натальи, и ответ на её вопрос —
      // строка Ивана в её блоке, а не карточка самого Ивана. Звать некому
      // (черновик открыт ссылкой) — открываем саму карточку-группу.
      const firstGroup = groupIds[0];
      if (firstGroup) {
        if (router.canGoBack()) router.back();
        else {
          router.replace(
            scope && !scope.isActive
              ? clientCardHref(firstGroup, scope.tenantId)
              : `/clients/${firstGroup}`,
          );
        }
        return created.id;
      }
      const card =
        scope && !scope.isActive
          ? clientCardHref(created.id, scope.tenantId)
          : { pathname: "/clients/[id]" as const, params: { id: created.id } };
      router.replace(
        opts.open ? { ...card, params: { ...card.params, open: opts.open } } : card,
      );
      // Засов не снимаем: экран уже уехал на карточку созданного клиента, и
      // повторное создание из этого черновика недопустимо.
      return created.id;
    } catch (error) {
      // Настоящий арбитр уникальности — частичный UNIQUE-индекс
      // clients_tenant_phone_e164_idx. Гонка двух устройств (или создание
      // в офлайне, доехавшее позже) приходит сюда как 23505. Показываем
      // того же существующего клиента, что и обычная ветка дедупа,
      // вместо сырого текста ошибки из Postgres.
      if (isPhoneTakenError(error)) {
        haptics.warning();
        if (e164 && tenantId) {
          const existing = await findDuplicate(e164);
          if (existing) {
            setDuplicate(existing);
            savingRef.current = false;
            return null;
          }
        }
        // В компании, где человек работает, номер может принадлежать клиенту,
        // которого ему не видно: говорим нейтрально и без двери в карточку —
        // иначе перебором номеров узнавали бы, кто клиент (сверено с 015).
        setCreateError(
          scope?.kind === "member"
            ? "Клиент с этим номером уже есть у компании"
            : "Клиент с таким номером уже есть",
        );
        savingRef.current = false;
        return null;
      }
      setCreateError(friendlyCreateError(error));
    }
    savingRef.current = false;
    return null;
  };

  return {
    draft,
    /** Идёт создание прямо сейчас — уход со страницы после него не
     *  спрашивает «Удалить черновик?» (читается в момент ухода). */
    isSavingNow: () => savingRef.current,
    updateDraft,
    duplicate,
    createError,
    e164,
    isDirty,
    canSave,
    /** Черновик несёт связь — номер тогда необязателен (`draftCanSave`). */
    linked,
    /** В поле номера набрано что-то сверх кода страны. */
    phoneTyped,
    isSaving: create.isPending,
    onPhoneChange,
    onNameChange,
    save,
  };
}
