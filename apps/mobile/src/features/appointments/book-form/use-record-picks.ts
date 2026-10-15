import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useFocusEffect, type useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  locationAddressForBooking,
  type Client,
  type Location,
} from "@babun/shared/local/clients";
import type { Service } from "@/features/services/queries";
import type { Master, Team } from "@/features/reference/queries";
import type { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { resolveBookingClientPrefill } from "@/features/appointments/booking-prefill";
import {
  isMasterAllowedForTeam,
  reconcileBookingSelection,
} from "@/features/appointments/booking-selection";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import type { ServiceOverride } from "@/features/appointments/helpers";
import { lastTeamOfClient } from "./booking-history";
import type { EventLocationRow } from "./event-locations";

type Setter<T> = Dispatch<SetStateAction<T>>;

export type ChainStep = "idle" | "client" | "clientClosing" | "services" | "done";

export interface RecordPicksInput {
  kind: "work" | "event";
  isEdit: boolean;
  editing: Appointment | null;
  allAppts: Appointment[];
  teams: Team[];
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
  setLocationId: Setter<string | null>;
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
  allAppts,
  teams,
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
  setLocationId,
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
  const pickClient = (c: Client) => {
    // У СОБЫТИЯ КЛИЕНТ — ТОЛЬКО ЧЕЛОВЕК (клиент и объект у события независимы): команда, объект и любимый мастер за ним не
    // подтягиваются, цепочка «клиент → услуги» не запускается.
    if (kind === "event") {
      setClientId(c.id);
      setLocationId(null);
      haptics.tap();
      return;
    }
    const prefill = resolveBookingClientPrefill(c);
    // Continuity: команда по ПОСЛЕДНЕМУ визиту клиента, а не глобально-последняя.
    // Иначе любимый мастер клиента отсеивается как «не из той команды».
    //
    // ТОЛЬКО У НОВОЙ ЗАПИСИ. У сохранённой сменить клиента значит сменить
    // клиента: иначе запись молча переезжала бы в команду последнего визита
    // нового клиента — услуги прежней команды выпадали бы («Итого» 0,
    // «Сохранить» серый), счета оплаты становились бы чужими, — а его
    // «любимый» мастер подменял бы мастера записи в обход права менять команду.
    const lastTeamForClient = isEdit
      ? null
      : lastTeamOfClient(allAppts, teams, c.id);
    const targetTeam = lastTeamForClient ?? teamId;
    if (lastTeamForClient && lastTeamForClient !== teamId) {
      selectTeam(lastTeamForClient);
    }
    setClientId(prefill.clientId);
    setLocationId(prefill.locationId);
    setAddress(prefill.address);
    if (
      !isEdit &&
      prefill.masterId &&
      isMasterAllowedForTeam(
        masters.find((candidate) => candidate.id === prefill.masterId),
        targetTeam,
      )
    ) {
      setMasterId(prefill.masterId);
    }
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
  // КЛИЕНТ ЗАПИСИ С ОПЛАТОЙ НЕ МЕНЯЕТСЯ (оплатил один клиент, а запись
  // переставили на другого — странно). Тап по
  // клиенту не открывает выбор, а говорит почему; снятая оплата клиента не
  // держит. То же правило у сервера (`protect_paid_appointment_finance`).
  const moneyHoldsClient =
    !!editing && ((editing.prepaid_amount ?? 0) > 0 || (editing.paid_amount ?? 0) > 0);
  const pickClientOrRefuse = () => {
    if (moneyHoldsClient) {
      haptics.warning();
      toast("Клиента не сменить: по записи есть оплата. Сначала снимите оплату", "info");
      return;
    }
    setClientPickerOpen(true);
  };

  const openClientCard = () => {
    if (!clientId) return;
    haptics.tap();
    router.push({ pathname: "/client", params: { id: clientId } });
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
    moneyHoldsClient,
    pickClientOrRefuse,
    openClientCard,
    pickLocation,
    openEventObjectAdd,
    objectEditClient,
  };
}
