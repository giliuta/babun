import { describe, expect, it } from "bun:test";
import { listPhotosForAppointment } from "./appointment-photos";

const row = {
  id: "photo-1",
  appointment_id: "appointment-1",
  tenant_id: "tenant-1",
  storage_path: "tenant-1/appointment-1/photo-1.jpg",
  kind: "before",
  caption: "",
  location_id: null,
  taken_at: null,
  sort_order: 0,
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
};

function clientWithSignedResult(result: {
  data: { signedUrl: string } | null;
  error: { message: string } | null;
}) {
  return {
    from() {
      let orderCalls = 0;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          orderCalls += 1;
          return orderCalls === 2
            ? Promise.resolve({ data: [row], error: null })
            : builder;
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          createSignedUrl: async () => result,
          getPublicUrl: () => {
            throw new Error("private photos must never use a public URL");
          },
        };
      },
    },
  };
}

describe("appointment photo private URLs", () => {
  it("returns the signed URL for a private object", async () => {
    const photos = await listPhotosForAppointment(
      clientWithSignedResult({
        data: { signedUrl: "https://signed.example/photo" },
        error: null,
      }) as never,
      "appointment-1",
    );
    expect(photos[0]?.url).toBe("https://signed.example/photo");
  });

  it("surfaces signing errors instead of returning an unusable public URL", async () => {
    await expect(
      listPhotosForAppointment(
        clientWithSignedResult({
          data: null,
          error: { message: "permission denied" },
        }) as never,
        "appointment-1",
      ),
    ).rejects.toThrow("permission denied");
  });
});
