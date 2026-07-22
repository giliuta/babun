import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../mobile/src/features/appointments/AppointmentSheet.tsx",
  ),
  "utf8",
);
const compact = source.replace(/\s+/g, " ");

describe("native appointment payment contract", () => {
  it("keeps the prepayment editor before completion and exposes permanent reset for any receipt", () => {
    expect(compact).toContain('appointment.status !== "completed"');
    expect(compact).toContain("appointmentHasReceipt && appointment.status !==");
    expect(source).toContain('value="Отменить оплату"');
    expect(source).toContain("useResetAppointmentPayment");
    expect(source).not.toContain("useUndoAppointmentPayment");
  });

  it("supports partial settlement while preserving the one-tap full-debt default", () => {
    expect(source).toContain("setPaymentAmount(moneyDraft(debt))");
    expect(source).toContain("remainingDebt: debt");
    expect(source).toContain("останется");
  });

  it("shows refunded appointments as zero-debt history, not as payable", () => {
    expect(source).toContain('appointment?.payment_status === "refunded"');
    expect(source).toContain("Оплата возвращена");
    expect(source).toContain("Денег к зачёту и долга по этой заявке нет");
  });
});
