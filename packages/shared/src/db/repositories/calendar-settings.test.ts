import { describe, expect, test } from "bun:test";
import {
  getCalendarSettings,
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
      // Строка старого вида (без минут, цветов и функций) — проекция ставит
      // честные умолчания, а не выдумывает значения.
      startMinute: 0,
      endMinute: 0,
      timezone: "Asia/Dubai",
      bufferMinutes: 20,
      hideCancelled: true,
      showDayFinance: true,
      workStartHour: 8,
      workEndHour: 19,
      disabledFeatures: [],
    });
    expect(settings).not.toHaveProperty("personalLabels");
    expect(settings).not.toHaveProperty("personalDefaultLabel");
    // СНЕСЁННЫЕ НАСТРОЙКИ НЕ ВОСКРЕСАЮТ ЧЕРЕЗ СЕРВЕР. Колонки в базе остались
    // (`not null default`), и RPC их по-прежнему отдаёт — видно по
    // OPERATIONAL_ROW выше. Проекция обязана их игнорировать, иначе поле
    // вернётся в модель через заднюю дверь и снова начнёт обещать настройку,
    // которой нет (владелец 2026-09-10: сетка всегда 30, неделя всегда с
    // понедельника, «за пределами часов» — предупреждением, а не флагом).
    expect(settings).not.toHaveProperty("gridStep");
    expect(settings).not.toHaveProperty("weekStart");
    expect(settings).not.toHaveProperty("allowOvertime");
    expect(settings).not.toHaveProperty("scrollOpenHour");
  });

  // STORY-088: с 24.09 RPC отдаёт сотруднику цвета записи, «Доход и расход»
  // и функции компании — без них у мастера были заводские цвета, а в его
  // записи стояли выключенные у компании блоки.
  test("цвета, полоса денег и функции компании доходят до сотрудника", async () => {
    const supabase = {
      rpc() {
        return Promise.resolve({
          data: [
            {
              ...OPERATIONAL_ROW,
              show_day_finance: false,
              record_color_rule: "label",
              record_color_palette: { unpaid: "#112233" },
              record_color_fallback: "#445566",
              disabled_features: ["objects", "nonsense", "objects", "debts"],
              booking_block_order: ["team", "when", "client"],
            },
          ],
          error: null,
        });
      },
    };

    const settings = await getOperationalCalendarSettings(supabase as never);

    expect(settings.showDayFinance).toBe(false);
    expect(settings.recordColorRule).toBe("label");
    expect(settings.recordColorFallback).toBe("#445566");
    // Незнакомый ключ и повтор выброшены — выключить ими нечего.
    expect(settings.disabledFeatures).toEqual(["objects", "debts"]);
    expect(settings.bookingBlockOrder).toEqual(["team", "when", "client"]);
  });

  // КОНТРАКТ НА ДЕНЬ, КОГДА RPC НАУЧИТСЯ МИНУТАМ. Фолбэк `?? 0` обязан
  // отступать перед реальным значением, а не глотать его: иначе рельс мастера
  // молча округлит окно, которое владелец выставил барабаном.
  test("минуты окна проходят насквозь, когда RPC их отдаёт", async () => {
    const supabase = {
      rpc() {
        return Promise.resolve({
          data: [{ ...OPERATIONAL_ROW, start_minute: 30, end_minute: 45 }],
          error: null,
        });
      },
    };

    const settings = await getOperationalCalendarSettings(supabase as never);

    expect(settings.startMinute).toBe(30);
    expect(settings.endMinute).toBe(45);
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

  // ЦВЕТА ЗАПИСИ ПЕРЕЕХАЛИ С ТЕЛЕФОНА В КОМПАНИЮ (2026-09-12). Строка базы
  // приходит какой угодно — поэтому маппер обязан не пропустить ни чужой ключ,
  // ни «синий» вместо hex: цвет уезжает прямо в стиль и в измеритель
  // контраста, и мусор делает блок прозрачным молча.
  test("цвета записи доезжают с сервера, а мусор отсекается", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: {
                        start_hour: 0,
                        end_hour: 24,
                        timezone: "Europe/Nicosia",
                        buffer_minutes: 0,
                        hide_cancelled: false,
                        record_color_rule: "label",
                        record_color_palette: {
                          unpaid: "#112233",
                          noObject: "синий",
                          noClient: "#ffffff",
                          somethingElse: "#ffffff",
                        },
                        record_color_fallback: "rgba(0,0,0,0.5)",
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };

    const settings = await getCalendarSettings(supabase as never, "tenant-1");

    expect(settings.recordColorRule).toBe("label");
    expect(settings.recordColorPalette).toEqual({
      unpaid: "#112233",
      // Не hex — значит «ситуация не красит», а не «покрасим чем попало».
      noObject: null,
    });
    // Снятые случаи (25.09) и чужие ключи не переживают маппер.
    expect(settings.recordColorPalette).not.toHaveProperty("noClient");
    // Чужой ключ в палитре не переживает маппер.
    expect(settings.recordColorPalette).not.toHaveProperty("somethingElse");
    // Запасной цвет с альфой — тот самый случай, ради которого писалась
    // проверка: `rgba(...)` ломает и стиль, и измеритель.
    expect(settings.recordColorFallback).toBeUndefined();
  });

  test("правило-самозванец не доезжает до модели", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: {
                        start_hour: 0,
                        end_hour: 24,
                        timezone: "Europe/Nicosia",
                        buffer_minutes: 0,
                        hide_cancelled: false,
                        record_color_rule: "rainbow",
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };

    const settings = await getCalendarSettings(supabase as never, "tenant-1");

    expect(settings.recordColorRule).toBeUndefined();
  });

  // «СБРОСИТЬ К ЗАВОДСКОМУ» ОБЯЗАНО БЫТЬ ВЫРАЗИМЫМ. Пустая палитра и пустой
  // запасной цвет пишутся именно NULL: иначе колонка навсегда осталась бы с
  // последним выбором, и кнопки «как было» не существовало бы.
  test("пустая палитра и пустой запасной цвет пишутся как NULL", async () => {
    const upserts: Record<string, unknown>[] = [];
    const supabase = {
      from() {
        return {
          upsert(value: Record<string, unknown>) {
            upserts.push(value);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: {
                        start_hour: 0,
                        end_hour: 24,
                        timezone: "Europe/Nicosia",
                        buffer_minutes: 0,
                        hide_cancelled: false,
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };

    await updateCalendarSettings(supabase as never, "tenant-1", {
      recordColorRule: "service",
      recordColorPalette: {},
      recordColorFallback: "",
    });

    expect(upserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      record_color_rule: "service",
      record_color_palette: null,
      record_color_fallback: null,
    });
  });
});
