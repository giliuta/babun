import { useQuery } from "@tanstack/react-query";
import type { PhotoKind } from "@babun/shared/db/repositories/appointment-photos";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// ФОТО СО ВСЕХ ВЫЕЗДОВ КЛИЕНТА — «до/после», снятые командой в записях.
//
// Владелец 2026-08-03: «всё, что было проведено когда-либо в записях у
// клиента, автоматически отправляется во вкладку вложения». Фото визитов
// живут в своей таблице (`appointment_photos`, бакет appointment-photos) и
// заводятся на экране записи — здесь мы их только СОБИРАЕМ, чтобы страница
// вложений показывала всю документацию клиента, а не половину.
//
// Копий не делаем: файл остаётся один, страница вложений — вторая витрина
// того же файла. Копия рассинхронизировалась бы при удалении фото в записи.

const BUCKET = "appointment-photos";
const SIGNED_URL_TTL = 5 * 60;

export interface VisitPhoto {
  id: string;
  appointment_id: string;
  storage_path: string;
  url: string;
  kind: PhotoKind;
  created_at: string;
}

export const KIND_LABEL: Record<PhotoKind, string> = {
  before: "до работы",
  after: "после работы",
  other: "фото",
};

/** Фото всех записей клиента. `appointmentIds` приходят из уже загруженной
 *  истории визитов — второго запроса за записями не делаем. */
export function useClientVisitPhotos(
  clientId: string,
  appointmentIds: readonly string[],
) {
  const tenantId = useTenantId();
  // Ключ по отсортированному списку: набор записей меняется редко, а строка
  // даёт стабильный ключ кэша без лишних инвалидаций.
  const idsKey = [...appointmentIds].sort().join(",");
  return useQuery<VisitPhoto[]>({
    queryKey: ["client-visit-photos", tenantId, clientId, idsKey],
    enabled: !!tenantId && appointmentIds.length > 0,
    // Подписанные ссылки живут 5 минут — кэш не должен их пережить.
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_photos")
        .select("id, appointment_id, storage_path, kind, created_at")
        .in("appointment_id", [...appointmentIds])
        .order("created_at", { ascending: false });
      if (error) throw new Error(`visit photos: ${error.message}`);
      const rows = data ?? [];
      if (rows.length === 0) return [];

      // Пакетная подпись: по одной ссылке на файл — это N запросов на каждую
      // отрисовку страницы.
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(
          rows.map((r) => r.storage_path),
          SIGNED_URL_TTL,
        );
      if (signErr) throw new Error(`visit photos url: ${signErr.message}`);
      const urlByPath = new Map(
        (signed ?? []).map((s) => [s.path ?? "", s.signedUrl]),
      );

      return rows.flatMap((r) => {
        const url = urlByPath.get(r.storage_path);
        // Файл пропал из хранилища — строку не показываем: битая миниатюра
        // хуже отсутствующей.
        if (!url) return [];
        return [
          {
            id: r.id,
            appointment_id: r.appointment_id,
            storage_path: r.storage_path,
            url,
            kind: (r.kind as PhotoKind) ?? "other",
            created_at: r.created_at,
          },
        ];
      });
    },
  });
}
