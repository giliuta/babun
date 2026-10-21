import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFocusEffect, type useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  locationAddressForBooking,
  type Client,
  type Location,
} from "@babun/shared/local/clients";
import type { Service } from "@/features/services/queries";
import type { Master } from "@/features/reference/queries";
import type { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { resolveBookingClientPrefill } from "@/features/appointments/booking-prefill";
import {
  isMasterAllowedForTeam,
  reconcileBookingSelection,
} from "@/features/appointments/booking-selection";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import type { ServiceOverride } from "@/features/appointments/helpers";
import type { EventLocationRow } from "./event-locations";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type ChainStep = "idle" | "client" | "clientClosing" | "services" | "done";

export interface RecordPicksInput {
  kind: "work" | "event";
  isEdit: boolean;
  editing: Appointment | null;
  services: Service[];
  masters: Master[];
  clients: Client[];
  client: Client | null;
  clientId: string | null;
  teamId: string | null;
  setTeamId: Setter<string | null>;
  serviceIds: string[];
  setServiceIds: Setter<string[]>;
  setOverrides: Setter<Record<string, ServiceOverride>>;
  masterId: string | null;
  setMasterId: Setter<string | null>;
  setClientId: Setter<string | null>;
  locationId: string | null;
  setLocationId: Setter<string | null>;
  setCity: Setter<string | null>;
  setCityTouched: Setter<boolean>;
  setAddress: Setter<string>;
  setEventAddress: Setter<string>;
  clientLocations: Location[];
  eventLocationPool: EventLocationRow[];
  eventLocationOwner: Client | null;
  clientPickerOpen: boolean;
  setClientPickerOpen: Setter<boolean>;
  setObjectSheet: Setter<boolean>;
  toast: ReturnType<typeof useToast>;
  router: ReturnType<typeof useRouter>;
}

/** Picking the team, the client and the object, and the client→services chain state. */
export function useRecordPicks({
  kind,
  isEdit,
  editing,
  services,
  masters,
  clients,
  client,
  clientId,
  teamId,
  setTeamId,
  serviceIds,
  setServiceIds,
  setOverrides,
  masterId,
  setMasterId,
  setClientId,
  locationId,
  setLocationId,
  setCity,
  setCityTouched,
  setAddress,
  setEventAddress,
  clientLocations,
  eventLocationPool,
  eventLocationOwner,
  clientPickerOpen,
  setClientPickerOpen,
  setObjectSheet,
  toast,
  router,
}: RecordPicksInput) {
  const selectTeam = (nextTeamId: string | null) => {
    const next = reconcileBookingSelection({
      teamId: nextTeamId,
      serviceIds,
      masterId,
      services,
      masters,
    });
    // МЕТКА — СВОЯ У КАЖДОЙ КОМАНДЫ. Метка прежней команды в новой не
    // существует: она серела в шапке и уезжала в запись. Новая команда —
    // метка «как у дня» этой команды.
    if (nextTeamId !== teamId) {
      setCity(null);
      setCityTouched(false);
    }
    setTeamId(nextTeamId);
    setServiceIds(next.serviceIds);
    setMasterId(next.masterId);
    const keep = new Set(next.serviceIds);
    setOverrides((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([serviceId]) => keep.has(serviceId)),
      ),
    );
  };

  // ── выбор клиента: подставить объект + адрес + любимого мастера ──
  // ЦЕПОЧКА «СЛОТ → КЛИЕНТ → УСЛУГА»: после выбора клиента сразу открывается
  // выбор услуги, и его можно закрыть, не выбирая.
  //
  // Половина заявок начинается одинаково: время уже названо в попапе слота, а
  // дальше человек всё равно идёт в клиента и в услуги. Два тапа, которые он
  // сделает в любом случае, продукт делает за него — но НИЧЕГО НЕ ТРЕБУЕТ:
  // каждый лист закрывается, и под ним обычная форма.
  //
  // ТОЛЬКО НА СОЗДАНИИ. У правки клиент и услуги уже выбраны, и всплывший
  // поверх лист был бы помехой, а не помощью.
  //
  // ОДИН РАЗ ЗА ЖИЗНЬ ЭКРАНА, и только вперёд: idle → client → services →
  // done. Закрыл лист — цепочка кончилась и сама не воскреснет; иначе
  // закрытие выглядело бы сломанным. Это состояние, а не ref: второе звено
  // ждёт, пока доедет прайс, а ref эффект не будит.
  const [chainStep, setChainStep] = useState<ChainStep>("idle");
  // Мастер, которого подставил любимый клиента (а не рука человека).
  const favouriteSetRef = useRef<string | null>(null);
  // ОБЪЕКТ УХОДИТ ВМЕСТЕ С КЛИЕНТОМ — И ЕГО АДРЕС ТОЖЕ. Выбор объекта пишет
  // его адрес снимком (`pickLocation`), а смена или снятие клиента гасили
  // только ссылку: у события оставалась строка «Адрес» с домом прежнего
  // клиента и сохранялась в него.
  const dropClientObject = () => {
    if (locationId == null) return;
    setLocationId(null);
    setAddress("");
    if (kind === "event") setEventAddress("");
  };
  const clearClient = () => {
    setClientId(null);
    dropClientObject();
    if (masterId != null && masterId === favouriteSetRef.current) setMasterId(null);
    favouriteSetRef.current = null;
  };
  const pickClient = (c: Client) => {
    // У СОБЫТИЯ КЛИЕНТ — ТОЛЬКО ЧЕЛОВЕК (клиент и объект у события независимы): команда, объект и любимый мастер за ним не
    // подтягиваются, цепочка «клиент → услуги» не запускается.
    if (kind === "event") {
      // Объект, выбранный без клиента, остаётся, если он этого клиента;
      // объект другого клиента уходит — объект закрепляется за клиентом события.
      if (c.id !== clientId && eventLocationOwner?.id !== c.id) dropClientObject();
      setClientId(c.id);
      haptics.tap();
      return;
    }
    const prefill = resolveBookingClientPrefill(c);
    // КЛИЕНТ НЕ УВОДИТ ЗАПИСЬ В СВОЮ КОМАНДУ. Запись заводят в календаре,
    // который открыт: старого клиента записывают в новую команду, и команда
    // записи остаётся той, что выбрана. Прежде выбор клиента переносил запись в
    // команду его последнего визита — услуги выбранной команды пропадали, а
    // записать клиента в другую команду было нельзя вовсе.
    const targetTeam = teamId;
    setClientId(prefill.clientId);
    setLocationId(prefill.locationId);
    setAddress(prefill.address);
    const favourite =
      !isEdit &&
      prefill.masterId &&
      isMasterAllowedForTeam(
        masters.find((candidate) => candidate.id === prefill.masterId),
        targetTeam,
      )
        ? prefill.masterId
        : null;
    if (favourite) {
      setMasterId(favourite);
    } else if (masterId != null && masterId === favouriteSetRef.current) {
      // Мастер, подставленный любимым ПРЕЖНЕГО клиента, не остаётся у
      // нового: его никто не выбирал. Выбранного руками не трогаем.
      setMasterId(null);
    }
    favouriteSetRef.current = favourite;
    haptics.tap();
    // ЗА КЛИЕНТОМ СРАЗУ ИДУТ УСЛУГИ — второе звено цепочки. Только на СВЕЖЕЙ записи и ровно один раз:
    // человек, который вернулся сменить клиента у собранной записи, не должен
    // получать поверх неё лист услуг.
    //
    // СНАЧАЛА ЖДЁМ, ПОКА УЙДЁТ ШТОРКА КЛИЕНТА. Обе шторки — окна `Modal`, и
    // вторая, поданная пока первая ещё уходит, не показывается вовсе: iOS
    // отвечает «already presenting». Состояние при этом считало лист услуг
    // открытым, и тап по «Выбрать услугу» ставил то же самое значение —
    // экран замирал насмерть (после выбора клиента «Выбрать услугу» не
    // нажимался). Ждём `onExited` — тот же сигнал, что у «Добавить объект».
    if (chainStep === "client") {
      setChainStep(clientPickerOpen ? "clientClosing" : "services");
    }
  };

  // КАРТОЧКА КЛИЕНТА ПОВЕРХ ЗАПИСИ. Тот же приём, что у создания
  // клиента: общий маршрут `/client` над табами, а не вкладка «Клиенты»,
  // — иначе поверх записи ляжет вторая копия табов и «назад» уведёт на
  // календарь, потеряв набранное. Запись остаётся смонтированной под
  // карточкой, «назад» возвращает ровно в неё.
  // «Карточка из записи» как права нет: запись можно открывать всегда, если её
  // видишь, — дверь открыта всем.
  // КЛИЕНТА ЗАПИСИ С ОПЛАТОЙ НЕ ПОДМЕНЯЮТ — НО ПРАВЯТ. Деньги записаны на
  // этого клиента, и сервер (`protect_paid_appointment_finance`) не даст
  // поставить другого. Самого клиента — телефон, имя, объекты — править можно
  // всегда: тап открывает его карточку, а не выбор, который всё равно
  // кончился бы отказом. Без оплаты тап, как везде, открывает выбор.
  // Как у сервера: возвращённая оплата клиента уже не держит.
  const moneyHoldsClient =
    !!editing &&
    editing.payment_status !== "refunded" &&
    ((editing.prepaid_amount ?? 0) > 0 || (editing.paid_amount ?? 0) > 0);

  const openClientCard = () => {
    if (!clientId) return;
    haptics.tap();
    router.push({ pathname: "/client", params: { id: clientId } });
  };
  const pickClientOrOpenCard = () => {
    if (moneyHoldsClient) {
      openClientCard();
      return;
    }
    setClientPickerOpen(true);
  };

  const pickLocation = (id: string) => {
    setLocationId(id);
    // У события объект берётся из общего пула (он может принадлежать не
    // выбранному клиенту), у записи — только из объектов её клиента.
    const loc =
      (kind === "event"
        ? eventLocationPool.find((row) => row.loc.id === id)?.loc
        : clientLocations.find((l) => l.id === id)) ?? null;
    if (loc) {
      setAddress(locationAddressForBooking(loc));
      // Адрес-снимок события: объект могут удалить, а куда ехали — видно.
      if (kind === "event") setEventAddress(locationAddressForBooking(loc));
    }
    haptics.tap();
  };

  // «ДОБАВИТЬ ОБЪЕКТ» У СОБЫТИЯ. Выбрать объект можно без клиента, а вот
  // ЗАВЕСТИ новый — нет: своей таблицы у объекта нет, он лежит в `locations`
  // клиента. Поэтому строка не пропадает и не превращается в отговорку
  // «сначала выберите клиента» — она сама открывает выбор клиента и говорит,
  // зачем он понадобился.
  const openEventObjectAdd = () => {
    haptics.tap();
    if (!client) {
      toast("Объект заводится клиенту — выберите клиента");
      setClientPickerOpen(true);
      return;
    }
    setObjectSheet(true);
  };
  // Правка объекта пишет в карточку его ВЛАДЕЛЬЦА: у события это может быть
  // не тот клиент, что стоит в форме.
  const objectEditClient = kind === "event" ? eventLocationOwner : client;

  // КЛИЕНТ, ЗАВЕДЁННЫЙ РАДИ ЭТОЙ ЗАПИСИ. Карточка нового клиента открывается
  // ПОВЕРХ формы (`/client`), после «Готово» кладёт id в ящик и уходит
  // «назад»; форма забирает его, получив фокус. Дальше — тот же `pickClient`,
  // что и тап по списку: объект, любимый мастер, цепочка услуг. Список
  // клиентов может ещё ехать после инвалидации — держим id, пока созданный
  // в нём не появится.
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const id = takeCreatedClient();
      if (id) setCreatedClientId(id);
    }, []),
  );
  useEffect(() => {
    if (!createdClientId) return;
    const created = clients.find((c) => c.id === createdClientId);
    if (!created) return;
    setCreatedClientId(null);
    pickClient(created);
    // pickClient пересобирается каждый рендер; нужен только клиент.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdClientId, clients]);

  return {
    selectTeam,
    chainStep,
    setChainStep,
    pickClient,
    clearClient,
    moneyHoldsClient,
    pickClientOrOpenCard,
    openClientCard,
    pickLocation,
    openEventObjectAdd,
    objectEditClient,
  };
}
