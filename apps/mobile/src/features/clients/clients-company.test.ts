import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  capabilitiesOf,
  clientCardHref,
  clientsInsightsHref,
  clientsSettingsHref,
  clientsCompany,
  clientsRouteDecision,
  clientsSources,
  memberScope,
  offlineForeignWriteMessage,
  type ClientsCompany,
  type ClientsScope,
  type ClientsSources,
  type CompanyAccess,
  type MembershipRow,
} from "./clients-company";

const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";
const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const X = "aaaaaaaa-0000-0000-0000-00000000000x";
const Y = "bbbbbbbb-0000-0000-0000-00000000000y";
const NAMES = new Map([
  [GILIUTA, "Giliuta"],
  [AIRFIX, "AirFix"],
  [X, "X"],
  [Y, "Y"],
]);

const row = (tenantId: string, role: string, joinedAt: string): MembershipRow => ({ tenantId, role, joinedAt });
const tenantOf = (c: ClientsCompany) => (c.kind === "company" ? c.scope.tenantId : c.kind);
const access = (over: Partial<CompanyAccess> = {}): CompanyAccess => ({
  isOwner: false,
  clients: "write",
  scope: "own",
  contacts: "read",
  ...over,
});

/** Мастер Giliuta, владелец AirFix — тот самый живой случай 19.09. */
const EMPLOYEE_MEMBERSHIPS: MembershipRow[] = [
  row(GILIUTA, "master", "2026-09-15T08:57:41Z"),
  row(AIRFIX, "owner", "2026-04-28T18:50:39Z"),
];

describe("своя компания вкладки", () => {
  test("владелец активной — активная, даже без членств", () => {
    const c = clientsCompany({ activeTenantId: GILIUTA, activeRole: "owner", memberships: undefined, names: NAMES });
    assert.equal(tenantOf(c), GILIUTA);
    assert.equal(c.kind === "company" && c.scope.isActive, true);
    assert.equal(c.kind === "company" && c.scope.kind, "own");
  });

  test("мастер Giliuta и владелец AirFix — AirFix, не активная", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "master",
      memberships: EMPLOYEE_MEMBERSHIPS,
      names: NAMES,
    });
    assert.deepEqual(c, {
      kind: "company",
      scope: {
        tenantId: AIRFIX,
        tenantName: "AirFix",
        kind: "own",
        role: "owner",
        level: "write",
        contacts: true,
        everyClient: true,
        isActive: false,
      },
    });
  });

  test("диспетчер со своей компанией — своя", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "dispatcher",
      memberships: [row(GILIUTA, "dispatcher", "2026-09-01T00:00:00Z"), row(X, "owner", "2026-08-01T00:00:00Z")],
      names: NAMES,
    });
    assert.equal(tenantOf(c), X);
  });

  test("две своих при чужой активной — самая ранняя по вступлению, не по имени", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "master",
      memberships: [
        row(X, "owner", "2026-05-01T00:00:00Z"),
        row(Y, "owner", "2026-03-01T00:00:00Z"),
        row(GILIUTA, "master", "2026-09-01T00:00:00Z"),
      ],
      names: NAMES,
    });
    assert.equal(tenantOf(c), Y);
  });

  test("своей нет — none", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "master",
      memberships: [row(GILIUTA, "master", "2026-09-01T00:00:00Z")],
      names: NAMES,
    });
    assert.deepEqual(c, { kind: "none" });
  });

  test("мастер активной, членства в пути — unknown", () => {
    assert.deepEqual(
      clientsCompany({ activeTenantId: GILIUTA, activeRole: "master", memberships: undefined, names: NAMES }),
      { kind: "unknown" },
    );
  });

  test("сервер уже сказал «мастер», а старая строка помнит «владелец» — активную пропустить", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "master",
      memberships: [row(GILIUTA, "owner", "2026-01-01T00:00:00Z"), row(AIRFIX, "owner", "2026-05-01T00:00:00Z")],
      names: NAMES,
    });
    assert.equal(tenantOf(c), AIRFIX);
  });

  test("неизвестная роль в строке членства не считается владением", () => {
    const c = clientsCompany({
      activeTenantId: GILIUTA,
      activeRole: "master",
      memberships: [row(X, "admin", "2026-01-01T00:00:00Z")],
      names: NAMES,
    });
    assert.deepEqual(c, { kind: "none" });
  });
});

describe("компания работодателя как источник", () => {
  const make = (over: Partial<CompanyAccess> | undefined) =>
    memberScope(GILIUTA, "master", over === undefined ? undefined : access(over), NAMES, GILIUTA);

  test("«Меняет» — источник с правкой, контактами и активностью", () => {
    assert.deepEqual(make({}), {
      tenantId: GILIUTA,
      tenantName: "Giliuta",
      kind: "member",
      role: "master",
      level: "write",
      contacts: true,
      everyClient: false,
      isActive: true,
    });
  });

  test("«Смотрит» без телефонов и «Все клиенты» — читается из карты", () => {
    const scope = make({ clients: "read", contacts: "off", scope: "all" });
    assert.equal(scope?.level, "read");
    assert.equal(scope?.contacts, false);
    assert.equal(scope?.everyClient, true);
  });

  test("«Скрыт», пустая карта и владелец — источника нет", () => {
    assert.equal(make({ clients: "off" }), null);
    assert.equal(make({ clients: undefined }), null);
    assert.equal(make(undefined), null);
    assert.equal(memberScope(GILIUTA, "master", access({ isOwner: true }), NAMES, GILIUTA), null);
  });
});

describe("источники вкладки", () => {
  const base = {
    activeTenantId: GILIUTA,
    activeRole: "master" as const,
    memberships: EMPLOYEE_MEMBERSHIPS,
    names: NAMES,
  };

  test("своя плюс работодатель, своя первой", () => {
    const s = clientsSources({ ...base, access: new Map([[GILIUTA, access()]]) });
    assert.equal(s.loading, false);
    assert.equal(s.primary?.tenantId, AIRFIX);
    assert.deepEqual(s.list.map((x) => [x.tenantId, x.kind]), [[AIRFIX, "own"], [GILIUTA, "member"]]);
    assert.deepEqual(s.needAccess, [GILIUTA]);
  });

  test("работодатель не подтвердил — в списке только своя", () => {
    const s = clientsSources({ ...base, access: new Map([[GILIUTA, access({ clients: "off" })]]) });
    assert.deepEqual(s.list.map((x) => x.tenantId), [AIRFIX]);
  });

  test("карта работодателя ещё едет — своя уже видна, компания в очереди", () => {
    const s = clientsSources({ ...base, access: new Map() });
    assert.deepEqual(s.list.map((x) => x.tenantId), [AIRFIX]);
    assert.deepEqual(s.needAccess, [GILIUTA]);
  });

  test("своей компании нет — список из одного работодателя", () => {
    const s = clientsSources({
      ...base,
      memberships: [row(GILIUTA, "master", "2026-09-15T08:57:41Z")],
      access: new Map([[GILIUTA, access()]]),
    });
    assert.equal(s.primary, null);
    assert.deepEqual(s.list.map((x) => x.tenantId), [GILIUTA]);
  });

  test("членства ещё не приехали — ожидание, а не «клиентов нет»", () => {
    const s = clientsSources({ ...base, memberships: undefined, access: new Map() });
    assert.equal(s.loading, true);
    assert.deepEqual(s.list, []);
  });

  test("владелец активной компании: ожидания нет, список из одной своей", () => {
    const s = clientsSources({
      activeTenantId: GILIUTA,
      activeRole: "owner",
      memberships: undefined,
      names: NAMES,
      access: new Map(),
    });
    assert.equal(s.loading, false);
    assert.deepEqual(s.list.map((x) => x.tenantId), [GILIUTA]);
  });

  test("два работодателя — по дате вступления", () => {
    const s = clientsSources({
      activeTenantId: X,
      activeRole: "master",
      memberships: [
        row(X, "master", "2026-09-01T00:00:00Z"),
        row(Y, "master", "2026-03-01T00:00:00Z"),
      ],
      names: NAMES,
      access: new Map([
        [X, access()],
        [Y, access({ clients: "read" })],
      ]),
    });
    assert.deepEqual(s.list.map((x) => [x.tenantId, x.level]), [[Y, "read"], [X, "write"]]);
  });
});

describe("что можно в источнике", () => {
  const own = (isActive: boolean): ClientsScope => ({
    tenantId: AIRFIX,
    tenantName: "AirFix",
    kind: "own",
    role: "owner",
    level: "write",
    contacts: true,
    everyClient: true,
    isActive,
  });

  test("своя активная — всё", () => {
    assert.deepEqual(capabilitiesOf(own(true)), {
      manage: true,
      create: true,
      edit: true,
      contacts: true,
      money: true,
      book: true,
      files: true,
      links: true,
      onlineOnly: false,
    });
  });

  test("своя, но открыт чужой календарь — без записи и файлов, только онлайн", () => {
    const caps = capabilitiesOf(own(false));
    assert.equal(caps.manage, true);
    assert.equal(caps.book, false);
    assert.equal(caps.files, false);
    assert.equal(caps.onlineOnly, true);
  });

  test("работодатель «Меняет» — заводит и правит, хозяйства и денег нет", () => {
    // Завести клиента сотруднику с «Меняет» РАЗРЕШАЕТ сервер:
    // `create_client_with_tags` пускает владельца или
    // `access_company('clients','write')`. Кнопка была серой зря.
    const caps = capabilitiesOf(memberScope(GILIUTA, "master", access(), NAMES, GILIUTA)!);
    assert.deepEqual(caps, {
      manage: false,
      create: true,
      edit: true,
      contacts: true,
      money: false,
      // Календарь этой компании сейчас и открыт — запись пойдёт в него.
      book: true,
      files: false,
      // «Какие клиенты: из его календарей» — набор урезан, и блока людей нет.
      links: false,
      onlineOnly: true,
    });
  });

  test("работодатель, чей календарь закрыт, записи не даёт", () => {
    const caps = capabilitiesOf(memberScope(X, "master", access(), NAMES, GILIUTA)!);
    assert.equal(caps.book, false);
  });

  test("работодатель «Смотрит» без телефонов — ни правки, ни контактов", () => {
    const caps = capabilitiesOf(
      memberScope(GILIUTA, "master", access({ clients: "read", contacts: "off" }), NAMES, GILIUTA)!,
    );
    assert.equal(caps.edit, false);
    assert.equal(caps.contacts, false);
  });
});

const SOURCES: ClientsSources = clientsSources({
  activeTenantId: GILIUTA,
  activeRole: "master",
  memberships: EMPLOYEE_MEMBERSHIPS,
  names: NAMES,
  access: new Map([[GILIUTA, access()]]),
});

describe("чья карточка и чья вкладка открыты", () => {
  const base = {
    activeTenantId: GILIUTA,
    activeRole: "master" as const,
    activeName: "Giliuta",
    sources: SOURCES,
  };

  test("вкладка — своя компания первой", () => {
    const d = clientsRouteDecision({ ...base, kind: "tab" });
    assert.equal(d.state === "open" && d.scope.tenantId, AIRFIX);
  });

  test("вкладка, пока членства не приехали, — ждёт", () => {
    const d = clientsRouteDecision({
      ...base,
      kind: "tab",
      sources: { loading: true, primary: null, list: [], needAccess: [] },
    });
    assert.deepEqual(d, { state: "wait" });
  });

  test("вкладка без единого источника — словами", () => {
    const d = clientsRouteDecision({
      ...base,
      kind: "tab",
      sources: { loading: false, primary: null, list: [], needAccess: [] },
    });
    assert.deepEqual(d, { state: "words", reason: "no-company" });
  });

  test("вкладка с чужим ?tenant= — не найден", () => {
    assert.deepEqual(clientsRouteDecision({ ...base, kind: "tab", tenantParam: X }), {
      state: "words",
      reason: "not-found",
    });
  });

  test("карточка без ?tenant= — компания календаря, источником работодателя", () => {
    const d = clientsRouteDecision({ ...base, kind: "card" });
    assert.equal(d.state === "open" && d.scope.tenantId, GILIUTA);
    assert.equal(d.state === "open" && d.scope.kind, "member");
  });

  test("карточка своей компании по ?tenant= — своя", () => {
    const d = clientsRouteDecision({ ...base, kind: "card", tenantParam: AIRFIX });
    assert.equal(d.state === "open" && d.scope.tenantId, AIRFIX);
    assert.equal(d.state === "open" && d.scope.kind, "own");
  });

  test("карточка чужой компании — не найден", () => {
    assert.deepEqual(clientsRouteDecision({ ...base, kind: "card", tenantParam: X }), {
      state: "words",
      reason: "not-found",
    });
  });

  test("мастер без базы открывает клиента своей записи", () => {
    const d = clientsRouteDecision({
      ...base,
      kind: "card",
      sources: clientsSources({
        activeTenantId: GILIUTA,
        activeRole: "master",
        memberships: [row(GILIUTA, "master", "2026-09-15T08:57:41Z")],
        names: NAMES,
        access: new Map([[GILIUTA, access({ clients: "off" })]]),
      }),
    });
    assert.equal(d.state === "open" && d.scope.kind, "record");
    assert.equal(d.state === "open" && d.scope.level, "read");
  });

  test("визиты и вложения клиента работодателя — словами", () => {
    assert.deepEqual(clientsRouteDecision({ ...base, kind: "card-sub" }), {
      state: "words",
      reason: "not-allowed",
    });
    assert.deepEqual(clientsRouteDecision({ ...base, kind: "card-sub", tenantParam: GILIUTA }), {
      state: "words",
      reason: "not-allowed",
    });
  });

  test("визиты своего клиента открываются", () => {
    const d = clientsRouteDecision({ ...base, kind: "card-sub", tenantParam: AIRFIX });
    assert.equal(d.state === "open" && d.scope.tenantId, AIRFIX);
  });

  test("«Создать клиента» из записи — компания календаря, даже с ?tenant= своей", () => {
    const d = clientsRouteDecision({
      ...base,
      activeRole: "dispatcher",
      kind: "card",
      tenantParam: AIRFIX,
      forceActive: true,
    });
    assert.equal(d.state === "open" && d.scope.tenantId, GILIUTA);
  });

  test("владелец активной компании без членств — карточка открывается сразу", () => {
    const d = clientsRouteDecision({
      activeTenantId: GILIUTA,
      activeRole: "owner",
      activeName: "Giliuta",
      sources: { loading: false, primary: null, list: [], needAccess: [] },
      kind: "card",
    });
    assert.equal(d.state === "open" && d.scope.kind, "own");
    assert.equal(d.state === "open" && d.scope.tenantName, "Giliuta");
  });
});

describe("двери шапки: своя компания, что бы ни было открыто в календаре", () => {
  const own = (isActive: boolean): ClientsScope => ({
    tenantId: AIRFIX,
    tenantName: "AirFix",
    kind: "own",
    role: "owner",
    level: "write",
    contacts: true,
    everyClient: true,
    isActive,
  });

  test("шестерёнка ведёт в настройки вкладки — ворота сами возьмут свою компанию", () => {
    assert.equal(clientsSettingsHref(), "/clients/settings");
  });

  test("своя компания открыта — аналитика без хвоста", () => {
    assert.deepEqual(clientsInsightsHref(own(true)), {
      pathname: "/cabinet/insights",
      params: {},
    });
  });

  test("в календаре чужая — аналитика несёт свою компанию", () => {
    assert.deepEqual(clientsInsightsHref(own(false)), {
      pathname: "/cabinet/insights",
      params: { tenant: AIRFIX },
    });
  });

  test("двери есть у своей компании и тогда, когда открыта чужая", () => {
    // Здесь был промах первого захода: шестерёнка и аналитика гасли, пока
    // своя компания не открыта в календаре (владелец 20.09: «у нас пропали
    // шестерёнки… визуал вообще не меняется»).
    assert.equal(capabilitiesOf(own(false)).manage, true);
    assert.equal(capabilitiesOf(own(false)).create, true);
  });
});

describe("ссылка и текст отказа", () => {
  test("ссылка на карточку несёт компанию", () => {
    assert.deepEqual(clientCardHref("c-1", AIRFIX), { pathname: "/clients/[id]", params: { id: "c-1", tenant: AIRFIX } });
  });

  test("отказ без сети называет компанию", () => {
    assert.equal(
      offlineForeignWriteMessage("AirFix"),
      "Нет интернета. Клиенты «AirFix» сохраняются только онлайн, пока в календаре открыта другая компания — подключитесь и повторите.",
    );
    assert.equal(
      offlineForeignWriteMessage(null),
      "Нет интернета. Клиенты вашей компании сохраняются только онлайн, пока в календаре открыта другая компания — подключитесь и повторите.",
    );
  });
});
