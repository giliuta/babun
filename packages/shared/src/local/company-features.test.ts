import { describe, expect, test } from "bun:test";
import {
  COMPANY_FEATURES,
  featureOfBookingBlock,
  isFeatureOn,
  sanitizeDisabledFeatures,
  withFeature,
} from "./company-features";

describe("функции компании", () => {
  test("пусто — включено всё; незнакомое ничего не выключает", () => {
    expect(isFeatureOn(undefined, "objects")).toBe(true);
    expect(isFeatureOn([], "objects")).toBe(true);
    expect(isFeatureOn(["objects"], "objects")).toBe(false);
    expect(sanitizeDisabledFeatures(["objects", 5, "x", "objects"])).toEqual(["objects"]);
    expect(sanitizeDisabledFeatures(null)).toEqual([]);
  });

  test("переключение пишет список без повторов в порядке страницы", () => {
    expect(withFeature(["debts"], "objects", false)).toEqual(["objects", "debts"]);
    expect(withFeature(["objects", "debts"], "objects", true)).toEqual(["debts"]);
    expect(withFeature(undefined, "debts", true)).toEqual([]);
  });

  test("функции записи отвечают за свои блоки формы", () => {
    expect(featureOfBookingBlock("object")).toBe("objects");
    expect(featureOfBookingBlock("label")).toBe("record_label");
    expect(featureOfBookingBlock("client")).toBeNull();
  });

  test("ключи совпадают со сторожем базы", () => {
    // Список в `calendar_settings_disabled_features_known`
    // (миграция 20260924140000): ключ вне его база не примет.
    expect(COMPANY_FEATURES.map((f) => f.key)).toEqual([
      "objects", "record_label", "record_payment", "record_note", "record_files",
      "day_labels", "events", "debts", "accounts", "documents",
      "client_people", "client_requisites", "client_files",
    ]);
  });
});
