import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useClientsCapabilities, useClientsScopeOrNull } from "@/session/company-scope";
import { useReferenceHref } from "@/lib/reference-href";
import { draftLinkFromParams, type DraftLinkParams } from "@/features/clients/useClientDraft";
import { useCurrentRole } from "@/session/tenant";

/** Address of the card: which client (or a draft), who opened it and from
 *  where, and with which rights. */
export function useCardRoute() {
  const {
    id,
    name: prefillName,
    phone: prefillPhone,
    open: openOnArrive,
    split: splitParam,
    team: teamParam,
    ...linkParams
  } = useLocalSearchParams<
    { id: string; open?: string; split?: string; team?: string } & DraftLinkParams
  >();
  const router = useRouter();
  // Страницы карточки — во вкладке или поверх записи (`/client`), смотря
  // откуда открыта сама карточка.
  const subPage = useReferenceHref().clientPage;
  const pathname = usePathname();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const scope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();

  // «new» → черновик без запросов; иначе обычная карточка с сервера.
  const isDraft = id === "new";
  // Связь, с которой черновик открыла дверь «Создать клиента» в шторке людей
  // (ТЗ, сценарий г-б): она едет адресом и уходит в базу вместе с клиентом.
  const draftLink = isDraft ? draftLinkFromParams(linkParams) : null;
  // Черновик, открытый ПОВЕРХ записи (`/book/client`): «Создать клиента»
  // отдаёт клиента записи и уходит «назад», а не на карточку созданного. Режим
  // читается по маршруту, а не по флагу в памяти: флаг пережил бы уход с
  // экрана и подставил бы следующего клиента, заведённого уже из списка.
  // ОТДАТЬ СОЗДАННОГО ТОМУ, КТО ПОЗВАЛ. Карточка, открытая общим адресом
  // `/client`, лежит ПОВЕРХ звавшего (запись, шторка долга): «Создать» кладёт id
  // в ящик и уходит «назад», а не на карточку нового клиента. Открытая своим
  // маршрутом внутри вкладки «Клиенты» — ведёт себя как обычно.
  //
  // Читается по маршруту, а не по флагу в памяти: флаг пережил бы уход с
  // экрана и подставил бы следующего клиента, заведённого уже из списка.
  //
  // ЧЕРНОВИК СО СВЯЗЬЮ ЗВАВШЕМУ НЕ ОТДАЁТСЯ. Его открыла карточка-группа, а
  // не запись под ней: жилец Натальи, положенный в ящик, подставился бы
  // записи клиентом. Он возвращается к Наталье (`useClientDraft.save`).
  const handBack = isDraft && pathname === "/client" && !draftLink;
  return {
    id,
    prefillName,
    prefillPhone,
    openOnArrive,
    splitParam,
    teamParam,
    linkParams,
    router,
    subPage,
    pathname,
    roleQuery,
    role,
    scope,
    caps,
    isDraft,
    draftLink,
    handBack,
  };
}
