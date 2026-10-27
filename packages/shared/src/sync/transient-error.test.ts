import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isTransientNetworkError, isTransportFailure } from "./transient-error";

describe("isTransientNetworkError", () => {
  test("fetch failures of every runtime are transient", () => {
    for (const message of ["Failed to fetch", "Load failed", "Network request failed"]) {
      assert.equal(isTransientNetworkError(new TypeError(message)), true, message);
    }
  });

  test("gateway 5xx is transient by status and by wording", () => {
    assert.equal(isTransientNetworkError({ status: 503, message: "x" }), true);
    assert.equal(isTransientNetworkError({ statusCode: 502 }), true);
    assert.equal(isTransientNetworkError(new Error("502 Bad Gateway")), true);
  });

  test("a plain error object is read by its message", () => {
    assert.equal(isTransientNetworkError({ message: "request timed out" }), true);
  });

  test("server rejections are not transient", () => {
    assert.equal(
      isTransientNetworkError({ status: 403, message: "new row violates row-level security policy" }),
      false,
    );
    assert.equal(isTransientNetworkError(new Error("duplicate key value")), false);
  });
});

describe("число в отказе сервера — не обрыв", () => {
  test("отказ функции базы с 502/503/504 в тексте — попытка, а не вечный обрыв", () => {
    for (const message of [
      "replay update: Сумма 503 больше итога",
      "replay update: номер 504 уже занят",
      "Error 502",
    ]) {
      assert.equal(isTransientNetworkError(new Error(message)), false, message);
    }
  });

  test("шлюз называет себя словами — обрыв", () => {
    for (const message of [
      "replay update: Gateway Timeout",
      "replay update: Service Unavailable",
      "replay update: The upstream server is timing out",
      "replay update: An invalid response was received from the upstream server",
    ]) {
      assert.equal(isTransientNetworkError(new Error(message)), true, message);
    }
  });
});

describe("isTransportFailure", () => {
  test("ответа не было — да; сервер ответил 5xx или таймаутом — нет", () => {
    assert.equal(isTransportFailure(new TypeError("Network request failed")), true);
    assert.equal(isTransportFailure(new Error("replay update: TypeError: Failed to fetch")), true);
    assert.equal(isTransportFailure(new Error("replay update: Gateway Timeout")), false);
    assert.equal(
      isTransportFailure(new Error("replay update: canceling statement due to statement timeout")),
      false,
    );
  });
});
