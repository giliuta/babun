import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import type {
  Client,
  ClientMembership,
  Location,
} from "@babun/shared/local/clients";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { clientCardHref } from "@/features/clients/clients-company";
import {
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/features/clients/company-scope";
import { MemberOfLine } from "@/features/clients/MemberOfLine";
import {
  ClientLinkRows,
  type ClientLinkItem,
} from "@/features/clients/blocks/ClientLinksBlock";
import type { LinkDraft } from "@/features/clients/LinkPickerSheet";
import { LinkDoor, type LinkDoorAsk } from "@/features/clients/ClientLinkDoor";
import { useClientMembers, useMemberOf } from "@/features/clients/use-client-links";
import {
  linkKeyOf,
  parseLinkKey,
  useLinkWriter,
} from "@/features/clients/use-link-writer";
import {
  draftLinkParams,
  type DraftLinkParams,
} from "@/features/clients/useClientDraft";

// ЛЮДИ КАРТОЧКИ И ДВЕРЬ СВЯЗИ СТРАНИЦЫ КЛИЕНТА (STORY-086).
//
// Вынесено из `app/(dashboard)/clients/[id].tsx`: страница — сборщик блоков,
// а здесь ход «лист → шторка → связь», строки людей, жильцы объекта и строка
// «чей он» под именем. Страница получает готовые куски и расставляет их.

// КЛЮЧ СТРОКИ СВЯЗИ ЭТОТ ФАЙЛ НЕ СОБИРАЕТ И НЕ РАЗБИРАЕТ САМ.
//
// Строка перечня — это СВЯЗЬ, а не человек: Иван законно стоит жильцом двух
// вилл одной управляющей, и ключ несёт человека, карточку и место. От ключа
// странице нужно то, чего в вёрстке строки нет: КОГО открыть по тапу и ГДЕ он
// живёт (жильцы виллы). Собирает и разбирает ключ ОДИН файл — писатель связей
// (`linkKeyOf` / `parseLinkKey`): свой разбор здесь разошёлся бы с ним молча —
// перечень под виллой опустел бы, а тап по строке увёл бы в «Клиент не
// найден».

/** Кого открывает строка связи — id человека; `null` — ключ не наш. */
function linkMemberId(item: ClientLinkItem): string | null {
  return parseLinkKey(item.key)?.memberId ?? null;
}

/** Где стоит связь — id объекта карточки-группы; `null` — связь без места
 *  (жена, управляющая): она законна и жильцом никого не делает. */
function linkPlaceId(item: ClientLinkItem): string | null {
  return parseLinkKey(item.key)?.locationId ?? null;
}

/** Черновик нового клиента — ТОЙ ЖЕ дорогой, которой открыта карточка.
 *  Одна на обе двери черновика со связью: «Создать клиента» в шторке людей и
 *  «Разделить клиента» в «⋯» (`use-split-client.ts`) — разойдись они, одна из
 *  них положила бы вторую копию табов поверх записи. */
export function newClientDraftHref(
  pathname: string,
  scope: { tenantId: string; isActive: boolean } | null,
  params: DraftLinkParams & { split?: string },
): Href {
  return pathname === "/client"
    ? { pathname: "/client", params: { id: "new", ...params } }
    : scope && !scope.isActive
      ? {
          pathname: "/clients/[id]",
          params: { id: "new", tenant: scope.tenantId, ...params },
        }
      : { pathname: "/clients/[id]", params: { id: "new", ...params } };
}

/** Пропы жильцов для `ClientProfileBlocks`: под объектом на странице —
 *  показание, в листе объекта — строки с ролью и единственная дверь. */
export interface ResidentProps {
  residentsLine?: (loc: Location) => string | undefined;
  residentsAt?: (loc: Location) => readonly ClientLinkItem[];
  onAddResident?: (loc: Location) => void;
  onOpenResident: (item: ClientLinkItem) => void;
  onResidentRole?: (item: ClientLinkItem, role: string) => void;
  onRemoveResident?: (item: ClientLinkItem) => void;
}

/** Сколько людей показывает карточка; остальные — за дверью «Все люди». */
export const PEOPLE_ON_CARD = 3;

export interface ClientPeople {
  /** Строки «чей он» под именем. */
  memberOfRows: ReactNode;
  /** Люди карточки в блоке «Клиент». */
  peopleRows: ReactNode;
  /** Сколько людей у карточки всего и сколько не поместилось: по ним
   *  страница рисует дверь «Все люди · N» (владелец 22.09). */
  peopleTotal: number;
  peopleHidden: number;
  /** Пункт «Человек» в листе «Добавить»; нет — пункта нет. */
  onAddPerson?: () => void;
  residents: ResidentProps;
  /** Шторка выбора человека — ставится в конец экрана, вне прокрутки. */
  door: ReactNode;
}

export function useClientPeople({
  id,
  client: c,
  isDraft,
  onDraftLinks,
  onDraftAddPerson,
  openPersonOnArrive,
  onArrived,
  limit,
}: {
  /** id из маршрута: перечень людей спрашивается сразу, не дожидаясь строки. */
  id: string;
  /** Черновик или серверная строка; `undefined` — ещё не приехала. */
  client: Client | undefined;
  isDraft: boolean;
  /** Черновик: связь, приехавшая с дверью, снимается правкой черновика. */
  onDraftLinks: (memberships: ClientMembership[]) => void;
  /** «Человек» в НОВОМ клиенте: у черновика нет id, и привязать к нему
   *  некого — страница сперва создаёт клиента, потом открывает дверь. */
  onDraftAddPerson?: () => void;
  /** Карточку открыли сразу после создания пунктом «Человек» — поднять
   *  шторку «Кто это», как только перечень людей ответил. */
  openPersonOnArrive?: boolean;
  /** Шторку подняли — снять пометку с маршрута, чтобы «назад» и повторный
   *  рендер не открывали её снова. */
  onArrived?: () => void;
  /** Сколько строк показывать; без него — все (страница «Люди»). */
  limit?: number;
}): ClientPeople {
  const t = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const scope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();
  // ЛЮДИ КАРТОЧКИ приезжают ОТДЕЛЬНЫМ запросом: связь живёт у члена, и в
  // строке самой карточки её нет. У черновика id ещё не существует, а без
  // права (`caps.links`: вся база и её контакты) сервер всё равно ответит
  // нулём — спрашивать не о чем.
  const members = useClientMembers(isDraft || !caps.links ? null : id);
  const linkWriter = useLinkWriter();
  const toast = useToast();
  // Строка, которую только что завели: курсор сразу в её роль (владелец
  // 2026-09-21 — «не надо делать лишние этапы»).
  const [roleFocusKey, setRoleFocusKey] = useState<string | null>(null);
  // Вопрос двери держится ДО КОНЦА анимации ухода шторки, поэтому «что
  // спрашиваем» и «видно ли» — два разных состояния: сбрось вопрос вместе с
  // видимостью, и шторка уезжала бы вниз уже без заголовка.
  const [door, setDoor] = useState<LinkDoorAsk | null>(null);
  const [doorOpen, setDoorOpen] = useState(false);
  // ВЫБОР ПРИМЕНЯЕТСЯ, КОГДА ШТОРКА УЖЕ УШЛА. Новая строка встаёт в перечень
  // с курсором в роли, а курсор — это `autoFocus` на монтировании: поставь
  // его, пока окно шторки ещё поднято, и фокус достанется полю под чужим
  // окном — клавиатура либо не выйдет, либо уедет вместе со шторкой.
  const afterDoor = useRef<(() => void) | null>(null);

  // ЧЕЙ ОН САМ — из его собственной строки: связь живёт у члена, и второго
  // запроса для этого не нужно. Под тем же правом, что и люди карточки:
  // сотруднику, которому видна не вся база, связь приходит, а карточка, на
  // которую она указывает, — нет, и строку назвать было бы нечем (ТЗ, дыра 9).
  const memberOf = useMemberOf(caps.links ? c ?? null : null);

  // ЖИЛЬЦЫ ОБЪЕКТА — ТЕ ЖЕ ЛЮДИ КАРТОЧКИ, названные местом. Второго запроса
  // у них нет: «кто живёт в Вилле 5» — это уже приехавший перечень,
  // отфильтрованный по id объекта. Связь БЕЗ места жильцом не делает — жена
  // и управляющая входят в ту же карточку, и показывать их под виллой
  // значило бы врать про то, кто там живёт.
  const residentsAt = useCallback(
    (loc: Location) => members.data.filter((item) => linkPlaceId(item) === loc.id),
    [members.data],
  );
  // ПОКАЗАНИЕ ПОД ОБЪЕКТОМ — «Мария Спиру · жилец, Андреас · жилец». Имя и
  // роль через «·», люди через запятую: та же анатомия, что у строки связи,
  // только без места — место здесь и есть сама строка объекта.
  const residentsLine = useCallback(
    (loc: Location) => {
      const rows = residentsAt(loc);
      if (rows.length === 0) return undefined;
      return rows
        .map((r) => [r.name.trim(), r.role.trim()].filter(Boolean).join(" · "))
        .join(", ");
    },
    [residentsAt],
  );

  // ЛЮДИ КАРТОЧКИ: БЛОК ЕСТЬ ЦЕЛИКОМ ИЛИ ЕГО НЕТ. Право (`caps.links`) гасит
  // его сразу, не дожидаясь ответа; последнее слово — у сервера
  // (`unavailable`): он отдаёт набор только тому, кому видна вся база и её
  // контакты, и половина перечня была бы запрещённым «видно, но не всё».
  //
  // ДО ПЕРВОГО ОТВЕТА БЛОКА ТОЖЕ НЕТ. Пустой перечень с одной дверью
  // «Добавить человека» читался бы как «людей у карточки нет», а их просто
  // ещё не принесли; с повторами запроса это секунды, а не кадр.
  const showLinks =
    !isDraft && caps.links && !members.unavailable && !members.isLoading;
  // Писать связи — там, где перечень стоит и приехал, и только правом
  // «Меняет». Упавший перечень двери не держит: новый человек не встал бы в
  // строки, которых нет, и тап выглядел бы несработавшим.
  const canWriteLinks = showLinks && caps.edit && !members.isError;

  /** Карточка другого клиента — В ТОЙ ЖЕ КОМПАНИИ, что открытая: связи
   *  живут внутри одной базы, и уходить из неё по тапу нельзя. */
  const cardHref = (clientId: string): Href =>
    scope && !scope.isActive
      ? clientCardHref(clientId, scope.tenantId)
      : `/clients/${clientId}`;

  /** Черновик нового клиента — ТОЙ ЖЕ дорогой, которой открыта карточка:
   *  общий адрес `/client` лежит поверх звавшего (запись), и уход во вкладку
   *  «Клиенты» положил бы поверх неё вторую копию табов. */
  const draftHref = (params: DraftLinkParams): Href =>
    newClientDraftHref(pathname, scope, params);

  const askLink = (ask: LinkDoorAsk) => {
    setDoor(ask);
    setDoorOpen(true);
  };

  /** Человека выбрали: связь пишется по ЕГО карточке, а строка встаёт в
   *  перечень до ответа сервера — поэтому курсор в роль ставится тем же
   *  движением, а не вторым шагом. Лист объекта при этом НЕ открывается
   *  заново: человек уже на странице и видит жильца под виллой. */
  const onPickLink = (member: Client, link: LinkDraft) => {
    if (!c) return;
    const groupId = c.id;
    const locationId = link.locationId ?? null;
    afterDoor.current = () => {
      setRoleFocusKey(linkKeyOf({ memberId: member.id, groupId, locationId }));
      void linkWriter.attach(member, { groupId, role: link.role, locationId });
    };
    setDoorOpen(false);
  };

  /** ЧЕЛОВЕКА НЕТ — «Создать клиента» (ТЗ, сценарий г-б). Поверх открывается
   *  ТА ЖЕ страница черновиком: имя и номер разобраны шторкой из поиска, а
   *  связь («жилец · Наталья · Вилла 5») едет адресом и уезжает в базу ОДНОЙ
   *  записью вместе с клиентом. Шторка зовёт это уже ушедшей, но своего
   *  `onExited` тогда не зовёт — вопрос двери снимаем здесь. */
  const onCreateLinked = (
    prefill: { name?: string; phone?: string },
    link: LinkDraft,
  ) => {
    afterDoor.current = null;
    setDoor(null);
    if (!c) return;
    router.push(draftHref(draftLinkParams(c.id, link, prefill)));
  };

  /** Карточка человека из строки связи. Ключ не наш — открывать нечего:
   *  тап по такой строке увёл бы в «Клиент не найден». */
  const openMember = (item: ClientLinkItem) => {
    const memberId = linkMemberId(item);
    if (memberId) router.push(cardHref(memberId));
  };

  /** Шторка ушла и её окно снято — теперь можно и писать, и ставить курсор. */
  const onDoorExited = () => {
    const run = afterDoor.current;
    afterDoor.current = null;
    setDoor(null);
    run?.();
  };

  /** СВЯЗЬ ЧЕРНОВИКА СНИМАЕТСЯ, А НЕ ВМЕСТЕ С ЧЕРНОВИКОМ (ТЗ, дыра 13).
   *  Ошиблись дверью — убирают связь, набранное остаётся. Тот же жест и то же
   *  слово, что у строки человека на карточке: правая кромка «Убрать». В
   *  черновике связь одна на карточку-группу — снимается по ней. */
  const removeDraftLink = (groupId: string) => {
    if (!c) return;
    // Без вопроса, как у строки человека и у объекта (владелец 22.09:
    // «всё можно вот так вот убирать» — свайпом).
    onDraftLinks((c.memberships ?? []).filter((m) => m.group_id !== groupId));
  };

  // ЧЕЙ ОН САМ — строки сразу под именем. В черновике шеврона нет: карточки,
  // на которую он указывает, отсюда ещё не открыть; зато связь можно снять.
  const memberOfRows =
    memberOf.unnamed ? (
      // Связи есть, назвать нечем — говорим словами, тише обычной строки, и
      // без шеврона: вести пока некуда.
      <MemberOfLine
        line={memberOf.unnamed === "failed" ? "Связи не загрузились" : "Связи загружаются…"}
      />
    ) :     memberOf.data.length > 0 ? (
      <>
        {memberOf.data.map((row) =>
          isDraft ? (
            <SwipeRow
              key={row.key}
              label="Убрать"
              color={t.danger}
              onAction={() => removeDraftLink(row.groupId)}
              accessibilityLabel={`Убрать связь ${row.line}`}
            >
              <MemberOfLine line={row.line} />
            </SwipeRow>
          ) : (
            <MemberOfLine
              key={row.key}
              line={row.line}
              onOpen={() => router.push(cardHref(row.groupId))}
            />
          ),
        )}
      </>
    ) : null;

  // ЛЮДИ КАРТОЧКИ И ИХ ДВЕРЬ — В ПЕРВОМ БЛОКЕ, ПОД ДВЕРЬЮ КОНТАКТОВ (владелец
  // 2026-09-21: «первый блок — клиент, туда входят люди, связи, компании…
  // всё в один блок»). Место перечня внутри блока держит сам блок контактов:
  // дверь «Добавить» с волоском разводит две правые кромки свайпа —
  // «Удалить» у номера и «Убрать» у человека.
  const allMembers = members.data ?? [];
  const shownMembers = limit ? allMembers.slice(0, limit) : allMembers;
  // УБРАЛИ СВАЙПОМ — БЕЗ ВОПРОСА, НО С «ОТМЕНИТЬ» (владелец 22.09: «всё
  // можно вот так вот убирать»; аудит 23.09: промах пальцем на ходу не должен
  // стоить связи). Подсказка держится пять секунд, как у архива.
  const removeLink = (item: ClientLinkItem) => {
    void linkWriter.detach(item).then((ok) => {
      if (!ok) return;
      toast(`Убрали: ${item.name.trim() || "связь"}`, "success", {
        label: "Отменить",
        onPress: () => void linkWriter.restore(item),
      });
    });
  };

  const peopleRows = showLinks ? (
    members.isError ? (
      // ПЕРЕЧЕНЬ НЕ ПРИЕХАЛ — ГОВОРИМ СЛОВАМИ, А НЕ ПУСТОТОЙ. Пустой блок с
      // одной дверью читался бы как «людей у карточки нет», а это неправда:
      // их просто не удалось получить. Двери в этом состоянии тоже нет —
      // добавленный человек не встал бы в перечень, которого нет, и тап
      // выглядел бы несработавшим.
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.separator,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
          Люди карточки сейчас не загрузились
        </Text>
      </View>
    ) : (
      // ОДНОЙ СТРОКОЙ И БЕЗ СВОЕЙ ДВЕРИ (владелец 22.09 по макету: «не очень
      // нравится», «аватар не нужен»). Четыре жильца высокими строками с
      // аватарами съедали экран, а вторая дверь «Добавить человека» спорила с
      // «Добавить» под номерами. Теперь человек — строка той же высоты, что
      // номер, а добавляют его из общей двери блока (пункт «Человек»).
      <ClientLinkRows
        items={shownMembers}
        compact
        separatedFirst={false}
        focusKey={roleFocusKey}
        onOpen={openMember}
        onRoleChange={
          caps.edit
            ? (item, role) => void linkWriter.setRole(item, role)
            : undefined
        }
        onRemove={caps.edit ? removeLink : undefined}
      />
    )
  ) : null;

  // «ЧЕЛОВЕК» ЕСТЬ И В НОВОМ КЛИЕНТЕ (владелец 22.09: «как добавить человека…
  // я не понимаю» — он был на черновике, а пункт жил только у сохранённой
  // карточки). В черновике пункт сперва создаёт клиента (гейт тот же, что у
  // футера), и на карточке сразу поднимается «Кто это».
  const onAddPerson =
    showLinks && caps.edit && !members.isError
      ? () => askLink({ title: "Кто это", role: "" })
      : isDraft && caps.edit && caps.links
        ? onDraftAddPerson
        : undefined;

  const arrived = useRef(false);
  useEffect(() => {
    if (!openPersonOnArrive || arrived.current) return;
    if (!showLinks || !caps.edit || members.isError) return;
    arrived.current = true;
    askLink({ title: "Кто это", role: "" });
    onArrived?.();
    // askLink/onArrived — свежие замыкания рендера; поднять нужно ровно раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPersonOnArrive, showLinks, caps.edit, members.isError]);

  const residents: ResidentProps = {
    residentsLine: showLinks ? residentsLine : undefined,
    residentsAt: showLinks ? residentsAt : undefined,
    onAddResident: canWriteLinks
      ? (loc) =>
          askLink({
            // «КТО ЗДЕСЬ ЖИВЁТ», А НЕ «КТО ЖИВЁТ В …». Имя объекта — это его
            // ТИП в именительном («Дом», «Квартира», «Офис», `object-types.ts`),
            // и склеенное «Кто живёт в Дом» читалось бы поломкой; склонять его
            // нечем. Какой это объект, человек только что видел — дверь стоит
            // в его же листе.
            title: "Кто здесь живёт",
            // Дверь приносит с собой половину ответа: и роль, и место здесь
            // уже решены самим вопросом.
            role: "жилец",
            locationId: loc.id,
          })
      : undefined,
    onOpenResident: openMember,
    onResidentRole: canWriteLinks
      ? (item, role) => void linkWriter.setRole(item, role)
      : undefined,
    onRemoveResident: canWriteLinks
      ? removeLink
      : undefined,
  };

  // ДВЕРЬ СВЯЗИ МОНТИРУЕТСЯ ТОЛЬКО ОТКРЫТОЙ. За строкой «жилец · Наталья» под
  // каждым именем стоит ВЕСЬ справочник компании, и читать его на каждое
  // открытие карточки незачем: пока дверь закрыта, её нет. Размонтируется она
  // не по тапу, а по концу анимации — иначе шторка не уезжает вниз, а
  // пропадает.
  const doorSheet =
    door && c ? (
      <LinkDoor
        ask={door}
        visible={doorOpen}
        group={c}
        onPick={onPickLink}
        onCreate={onCreateLinked}
        onClose={() => setDoorOpen(false)}
        onExited={onDoorExited}
      />
    ) : null;

  return {
    memberOfRows,
    peopleRows,
    peopleTotal: showLinks ? allMembers.length : 0,
    peopleHidden: showLinks ? allMembers.length - shownMembers.length : 0,
    onAddPerson,
    residents,
    door: doorSheet,
  };
}
