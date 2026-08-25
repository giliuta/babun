import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  can,
  canAccessCabinetPath,
  canAccessClientPath,
  isUserRole,
} from "./role-policy";

describe("role policy", () => {
  test("accepts only database membership roles", () => {
    assert.equal(isUserRole("owner"), true);
    assert.equal(isUserRole("dispatcher"), true);
    assert.equal(isUserRole("master"), true);
    assert.equal(isUserRole("admin"), false);
    assert.equal(isUserRole(null), false);
  });

  test("keeps finance and company management owner-only", () => {
    assert.equal(can("owner", "view-finances"), true);
    assert.equal(can("owner", "manage-company"), true);
    assert.equal(can("dispatcher", "view-finances"), false);
    assert.equal(can("dispatcher", "manage-company"), false);
    assert.equal(can("master", "view-finances"), false);
  });

  test("lets dispatcher operate clients and calendar", () => {
    assert.equal(can("dispatcher", "operate-clients"), true);
    assert.equal(can("dispatcher", "operate-calendar"), true);
    assert.equal(can("dispatcher", "create-appointment"), true);
    assert.equal(can("master", "operate-clients"), false);
    assert.equal(can("master", "operate-calendar"), true);
    assert.equal(can("master", "create-appointment"), false);
  });

  test("keeps the unfinished device-local chat prototype unreachable", () => {
    assert.equal(can("owner", "manage-messaging"), false);
    assert.equal(can("dispatcher", "manage-messaging"), false);
    assert.equal(can("master", "manage-messaging"), false);
  });

  test("uses an explicit cabinet route allow-list for non-owners", () => {
    assert.equal(canAccessCabinetPath("owner", "/cabinet/accounts"), true);
    assert.equal(canAccessCabinetPath("dispatcher", "/cabinet/recurring"), true);
    assert.equal(canAccessCabinetPath("dispatcher", "/cabinet/unclosed"), true);
    assert.equal(canAccessCabinetPath("dispatcher", "/cabinet/teams"), false);
    assert.equal(canAccessCabinetPath("master", "/cabinet/business/"), true);
    assert.equal(canAccessCabinetPath("master", "/cabinet/masters/master-1"), false);
    assert.equal(canAccessCabinetPath(null, "/cabinet"), false);
  });

  test("every cabinet link rendered for dispatcher and master is reachable", () => {
    const dispatcherLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
      "/cabinet/recurring",
      "/cabinet/sms-templates",
      "/cabinet/unclosed",
    ];
    const masterLinks = [
      "/cabinet",
      "/cabinet/account",
      "/cabinet/business",
      "/cabinet/inventory",
    ];
    const ownerOnlyLinks = [
      "/cabinet/accounts",
      "/cabinet/categories",
      "/cabinet/close-day",
      "/cabinet/event-types",
      "/cabinet/insights",
      "/cabinet/labels",
      "/cabinet/loyalty",
      "/cabinet/masters",
      "/cabinet/services",
      "/cabinet/team-access",
      "/cabinet/teams",
      "/cabinet/templates",
    ];

    for (const path of dispatcherLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), true, path);
    }
    for (const path of masterLinks) {
      assert.equal(canAccessCabinetPath("master", path), true, path);
    }
    for (const path of ownerOnlyLinks) {
      assert.equal(canAccessCabinetPath("dispatcher", path), false, path);
      assert.equal(canAccessCabinetPath("master", path), false, path);
    }
  });

  test("allows a master only an exact assigned-client detail route", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    assert.equal(canAccessClientPath("master", `/clients/${id}`), true);
    assert.equal(canAccessClientPath("master", "/clients"), false);
    assert.equal(canAccessClientPath("master", "/clients/settings"), false);
    assert.equal(canAccessClientPath("master", "/clients/archive"), false);
    assert.equal(canAccessClientPath("master", `/clients/${id}/edit`), false);
    assert.equal(canAccessClientPath("dispatcher", "/clients/settings"), true);
  });
});
