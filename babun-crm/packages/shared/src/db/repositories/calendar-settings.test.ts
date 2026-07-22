import { describe, expect, test } from "bun:test";
import {
  getOperationalCalendarSettings,
  updateCalendarSettings,
} from "./calendar-settings";

const OPERATIONAL_ROW = {
  start_hour: 7,
  end_hour: 23,
  grid_step: 15,
  week_start: "sunday",
  timezone: "Asia/Dubai",
  buffer_minutes: 20,
  hide_cancelled: true,
  allow_overtime: true,
  work_start_hour: 8,
  work_end_hour: 19,
  scroll_open_hour: 8,
};

describe("operational calendar settings repository", () => {
  test("maps the safe RPC without introducing private settings", async () => {
    const calls: string[] = [];
    const supabase = {
      rpc(name: string) {
        calls.push(name);
        return Promise.resolve({ data: [OPERATIONAL_ROW], error: null });
      },
    };

    const settings = await getOperationalCalendarSettings(supabase as never);

    expect(calls).toEqual(["read_operational_calendar_settings_safe"]);
    expect(settings).toEqual({
      startHour: 7,
      endHour: 23,
      gridStep: 15,
      weekStart: "sunday",
      timezone: "Asia/Dubai",
      bufferMinutes: 20,
      hideCancelled: true,
      allowOvertime: true,
      workStartHour: 8,
      workEndHour: 19,
      scrollOpenHour: 8,
    });
    expect(settings).not.toHaveProperty("personalLabels");
    expect(settings).not.toHaveProperty("personalDefaultLabel");
  });

  test("keeps the PostgREST code for strict fallback decisions", async () => {
    const supabase = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: {
            code: "42501",
            message: "permission denied",
            details: "row-level security",
          },
        });
      },
    };

    try {
      await getOperationalCalendarSettings(supabase as never);
      throw new Error("expected repository call to fail");
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("42501");
      expect((error as Error).message).toContain("permission denied");
    }
  });

  test("fails closed when a requested calendar column is not deployed", async () => {
    const upserts: unknown[] = [];
    const supabase = {
      from() {
        return {
          upsert(value: unknown) {
            upserts.push(value);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: null,
                      error: {
                        code: "42703",
                        message: 'column "work_start_hour" does not exist',
                      },
                    });
                  },
                };
              },
            };
          },
        };
      },
    };

    await expect(
      updateCalendarSettings(supabase as never, "tenant-1", {
        workStartHour: 8,
      }),
    ).rejects.toThrow("обновите схему");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      work_start_hour: 8,
    });
  });
});
