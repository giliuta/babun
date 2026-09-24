import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import {
  listMemberClients,
  useCreateClient,
  useUpdateClientById,
} from "@/features/clients/queries";
import { splitSourceStep, type SplitRef } from "@/features/clients/split-client";
import { notify } from "@/lib/notify";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { clientCardHref } from "@/features/clients/clients-company";
import {
  countryDialCode,
  formatPhoneAsYouType,
  tryToE164,
} from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { splitNameAndPhone } from "@/features/clients/name-phone-paste";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { haptics } from "@/lib/haptics";
import { deliverCreatedClient } from "@/features/appointments/pending-client";
import {
  friendlyCreateError,
  isPhoneTakenError,
} from "@/features/clients/client-create-errors";
import {
  clientMembersQueryKey,
  type LinkTarget,
} from "@/features/clients/use-link-writer";

// ─── ЧИСТОЕ ЯДРО: НАЧАЛО ───────────────────────────────────────────────
//
// Гейт черновика — решение владельца, а не деталь вёрстки, поэтому он вынесен
// чистой функцией между метками: сторож `link-writer.test.ts` вырезает эту
// секцию и проверяет её вызовом (сам хук тянет `expo-router`, в bun его не
// поднять). В ядро не ввозится ни одного значения — только типы.

/** Что знает гейт о черновике в эту секунду. */
/** Что открыть на карточке сразу после создания из черновика: «Кто это»,
 *  лист «Добавить файл» или форму записи (владелец 22.09: «при создании —
 *  те же самые блоки, что у созданного»). */
export type DraftOpen = "person" | "files" | "book";

export interface DraftGate {
  active: boolean;
  nameFilled: boolean;
  /** Разобранный номер; `null` — номера нет или он не разобран. */
  e164: string | null;
  /** В поле номера набрано что-то сверх кода страны. */
  phoneTyped: boolean;
  /** Черновик несёт связь (жилец, человек карточки). */
  linked: boolean;
  duplicate: boolean;
  saving: boolean;
}

/** МОЖНО ЛИ СОЗДАТЬ КЛИЕНТА.
 *
 *  Закон владельца 2026-07-25 — «телефон ОБЯЗАТЕЛЕН и УНИКАЛЕН» — остаётся для
 *  всех, кроме человека СО СВЯЗЬЮ: управляющая даёт имена жильцов без номеров
 *  (решение владельца по дыре 1 STORY-086), и дверь «Добавить жильца» иначе
 *  была бы погашена навсегда. Такой клиент находится не поиском по номеру, а
 *  строкой в карточке, в которую он входит, — ради неё его и заводят.
 *
 *  Начатый, но не разобранный номер — не «номера нет», а ошибка набора: его
 *  не пропускает и связь, иначе в базу уехал бы обрывок цифр без ключа.
 *
 *  ДУБЛИ У БЕЗНОМЕРНЫХ НЕ ИЩУТСЯ — это принятая цена: дедуп держится на
 *  `phone_e164`, а по имени его не построить (тёзок сколько угодно, закон
 *  владельца 2026-07-26). Двух Иванов-жильцов без номеров база различит только
 *  по связи. */
export function draftCanSave(gate: DraftGate): boolean {
  if (!gate.active || !gate.nameFilled || gate.duplicate || gate.saving) return false;
  if (gate.e164 !== null) return true;
  return gate.linked && !gate.phoneTyped;
}

/** Набрано ли в поле номера что-то сверх кода страны: поле рождается с ним
 *  (`+357 `), и сам код номером не считается. */
export function draftPhoneTyped(text: string, dial: string): boolean {
  const typed = text.trim();
  return typed !== "" && typed !== dial.trim();
}

/** Параметры маршрута черновика, открытого дверью связи (сценарий г-б). */
export type DraftLinkParams = {
  name?: string;
  phone?: string;
  linkGroup?: string;
  linkRole?: string;
  linkPlace?: string;
};

/** СВЯЗЬ ЕДЕТ В ЧЕРНОВИК АДРЕСОМ, И СОБИРАЕТ ЕГО ТОТ ЖЕ ФАЙЛ, ЧТО РАЗБИРАЕТ.
 *
 *  Дверь «Создать клиента» в шторке людей открывает страницу черновика
 *  маршрутом: память между экранами не переживает ни перезапуск, ни второй
 *  черновик. Пустые значения в адрес не кладутся — `?phone=` читался бы
 *  набранным номером. */
export function draftLinkParams(
  groupId: string,
  link: { role: string; locationId?: string | null },
  prefill: { name?: string; phone?: string },
): DraftLinkParams {
  const params: DraftLinkParams = { linkGroup: groupId };
  const role = link.role.trim();
  if (role) params.linkRole = role;
  if (link.locationId) params.linkPlace = link.locationId;
  const name = prefill.name?.trim();
  if (name) params.name = name;
  const phone = prefill.phone?.trim();
  if (phone) params.phone = phone;
  return params;
}

/** Обратный ход: адрес → связь черновика. Нет карточки-группы — связи нет
 *  (роль и место без неё ни к чему не привязаны). */
export function draftLinkFromParams(params: DraftLinkParams): LinkTarget | null {
  const groupId = params.linkGroup?.trim();
  if (!groupId) return null;
  return {
    groupId,
    role: params.linkRole?.trim() ?? "",
    locationId: params.linkPlace?.trim() || null,
  };
}

// ─── ЧИСТОЕ ЯДРО: КОНЕЦ ────────────────────────────────────────────────

export interface ClientDraftOptions {
  /** Черновик открыт ПОВЕРХ записи (`/book/client`): после «Готово» клиент
   *  отдаётся записи и экран уходит «назад», а не на карточку созданного. */
  /** Отдать созданного клиента тому, кто позвал, и уйти «назад», а не на его
   *  карточку. Так ведёт себя карточка, открытая ПОВЕРХ звавшего — из записи
   *  или из шторки долга (см. `app/(shared)`). */
  forBooking?: boolean;
  /** Что уже набрали в поиске клиента — имя или телефон. Перепечатывать
   *  их ещё раз в карточке незачем. */
  name?: string;
  phone?: string;
  /** Связь, с которой черновик ПРИЕХАЛ: дверь «Добавить жильца» / «Добавить
   *  человека» уже знает, чей он, кем и где (STORY-086, сценарий г-б). Она
   *  живёт в `draft.memberships` и уезжает ВМЕСТЕ с клиентом одной записью
   *  `create_client_with_tags` — второго запроса «а теперь привяжи» не бывает.
   *  Читается один раз, на рождении черновика. */
  link?: LinkTarget | null;
  /** Черновик открыт пунктом «Разделить клиента» (STORY-086, сценарий ж):
   *  номер — это запись `phones` исходной карточки, и после создания он
   *  уходит оттуда. Бросили черновик — исходная не тронута: убирается номер
   *  только в `save`, после того как клиент уже создан. */
  split?: SplitRef | null;
}

export function useClientDraft(
  active: boolean,
  { forBooking = false, name, phone, link, split }: ClientDraftOptions = {},
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
  // Код страны берём из профиля КОМПАНИИ (tenants.country), а не из константы
  // продукта: у кипрской фирмы поле открывается с «+357», у греческой — с
  // «+30». Номер, введённый со своим «+», всё равно уважается как есть.
  const country = useDefaultCountry();
  const dial = countryDialCode(country);
  const [draft, setDraft] = useState<Client>(() =>
    createBlankClient({
      full_name: name?.trim() ?? "",
      // ПУСТО, А НЕ «+357 »: код страны с 22.09 стоит ПОДПИСЬЮ над полем
      // (`use-phone-country.tsx`), и продублированный в значении он мешал —
      // после смены страны в поле оставался прежний код.
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
  // Свежий черновик для `save`: замыкание нажатия видит состояние до записи
  // поля, которое дописалось при снятии фокуса.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const e164 = active ? tryToE164(draft.phone.trim(), country) : null;

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

  /** Поиск клиента по каноническому номеру. Сеть — авторитет, но при её
   *  отказе ищем в ОФЛАЙН-КЭШЕ: правило владельца «телефон уникален» не
   *  должно отключаться вместе с сетью, когда весь список лежит в SQLite.
   *  Тот же приём уже применён на экране чата. */
  const findDuplicate = useCallback(async (key: string): Promise<Client | null> => {
    if (!tenantId) return null;
    const sameNumber = (list: readonly Client[]) =>
      list.find((c) => (c.phone_e164 ?? tryToE164(c.phone ?? "")) === key) ?? null;
    // В компании, где человек работает, таблица клиентов ему закрыта — дубль
    // ищется тем же окном, которым он её читает.
    if (scope?.kind === "member") {
      try {
        return sameNumber(await listMemberClients(tenantBoundClient(tenantId)));
      } catch {
        return null;
      }
    }
    try {
      return (await findClientByPhoneE164(draftClient, key, tenantId)) ?? null;
    } catch {
      try {
        const cached = await listClientsCached(draftClient, tenantId);
        return sameNumber(cached);
      } catch {
        // Ни сети, ни кэша — создать разрешаем, финальный арбитр всё равно
        // UNIQUE-индекс в базе (23505 обрабатывается ниже).
        return null;
      }
    }
  }, [tenantId, scope?.kind, draftClient]);

  const sequence = useRef(0);
  // Засов «идёт создание» — синхронный, в отличие от create.isPending.
  const savingRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const currentSequence = ++sequence.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      const existing = await findDuplicate(e164);
      if (sequence.current === currentSequence) setDuplicate(existing);
    }, 350);
    return () => clearTimeout(timer);
  }, [active, e164, tenantId, findDuplicate]);

  const isDirty = useMemo(() => {
    if (!active) return false;
    return Boolean(
      draft.full_name.trim() ||
        draft.phone.trim() !== dial ||
        draft.email.trim() ||
        draft.city.trim() ||
        draft.birthday ||
        draft.whatsapp_phone.trim() ||
        draft.telegram_username.trim() ||
        draft.instagram_username.trim() ||
        draft.phones.length ||
        draft.legal_name?.trim() ||
        draft.vat_number?.trim() ||
        draft.reg_number?.trim() ||
        draft.billing_address?.trim() ||
        draft.locations.length ||
        draft.notes.length ||
        draft.tag_ids.length ||
        // Связь, приехавшая с дверью, — тоже набранное: без этой строки
        // черновик жильца уходил по «Назад» молча, и человек пропадал вместе
        // с тем, что его заводили именно в эту виллу.
        draft.memberships?.length ||
        draft.acquisition_source !== "unknown" ||
        draft.blacklisted
    );
  }, [active, draft, dial]);

  // Владелец 2026-07-25: телефон ОБЯЗАТЕЛЕН и УНИКАЛЕН. Уникальность
  // держится на ключе phone_e164, поэтому «5+ цифр» больше не пропуск —
  // без разбираемого номера канонического ключа нет, а значит и дубль
  // ловить нечем. Разбор чисто локальный, офлайну не мешает.
  // Имя НЕ уникально (тёзок сколько угодно, дедуп только по номеру), но
  // ОБЯЗАТЕЛЬНО (владелец 2026-07-26): безымянный клиент не находится ни
  // поиском, ни глазами в списке, а в SMS-шаблон подставлять нечего.
  // Исключение одно — клиент СО СВЯЗЬЮ, по одному имени (`draftCanSave`).
  const nameFilled = draft.full_name.trim().length > 0;
  const linked = (draft.memberships?.length ?? 0) > 0;
  const phoneTyped = draftPhoneTyped(draft.phone, dial);
  // Дубль найден — сохранять НЕЧЕГО: два клиента на одном номере невозможны
  // (решение владельца), и save() при дубле молча выходил. Кнопка при этом
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
      .getQueriesData<Client | null>({ queryKey: ["client", ref.sourceId] })
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
    // терялось (аудит 22.09). Снимаем фокус, даём кадр на запись и читаем
    // черновик свежим — из ссылки, а не из замыкания этого нажатия.
    Keyboard.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const d = draftRef.current;

    // Дебаунс мог не успеть к быстрому тапу — перепроверяем перед записью.
    if (e164 && !duplicate && tenantId) {
      const existing = await findDuplicate(e164);
      if (existing) {
        haptics.warning();
        setDuplicate(existing);
        savingRef.current = false;
        return null;
      }
    }
    // Дубль уже найден дебаунсом — создать нельзя. Раньше второй тап
    // намеренно пропускал «другого человека на том же номере»; владелец
    // это отменил: два клиента на одном номере невозможны.
    if (duplicate) {
      haptics.warning();
      savingRef.current = false;
      return null;
    }

    try {
      const created = await create.mutateAsync({
        ...d,
        // Без разобранного номера гейт пропускает только пустое поле (клиент
        // со связью) — в нём один код страны, и в базу он уезжает пустым,
        // а не номером «+357».
        phone: e164 ? d.phone.trim() : "",
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
      // КЛИЕНТ, ЗАВЕДЁННЫЙ РАДИ ЗАПИСИ, ВОЗВРАЩАЕТСЯ В ЗАПИСЬ (владелец
      // 2026-08-31: «нажимаю „Готово" — и оно остаётся на странице клиента, а
      // должно сразу переходить в саму запись, я ж делаю в первую очередь
      // запись»).
      //
      // Карточка открыта ПОВЕРХ записи (`/book/client`, см. pending-client.ts):
      // запись стоит в стеке прямо под нами со всем набранным, поэтому
      // хватает отдать ей id и уйти «назад». Прежний путь — переоткрыть
      // запись со слотом из ящика — терял услуги и заметку, набранные до
      // похода за клиентом.
      if (forBooking) {
        deliverCreatedClient(created.id);
        router.back();
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
        setCreateError("Клиент с таким номером уже есть");
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
