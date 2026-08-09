import { useQuery } from "@tanstack/react-query";
import { randomUuid } from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";

// ДОКУМЕНТ ОПЕРАЦИИ В ХРАНИЛИЩЕ.
//
// Путь: {tenant_id}/{uuid}.{ext} в приватном бакете `receipts`. Ссылка живёт в
// finance_transactions.receipt_url — и колонка, и бакет существовали с самого
// начала, но приложить документ было нечем: у бакета не было ни одной политики
// (миграция 20260809140000_receipts_bucket_policies).
//
// Бакет приватный, поэтому наружу отдаётся КОРОТКОЖИВУЩАЯ подписанная ссылка,
// а не постоянный адрес: чек содержит реквизиты и суммы, и вечная ссылка на
// него — это утечка, которую невозможно отозвать.

const BUCKET = "receipts";
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL = 5 * 60;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
]);

export interface PickedReceipt {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

function extOf(file: PickedReceipt): string {
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.mimeType === "application/pdf") return "pdf";
  return "jpg";
}

/** Заливает файл и возвращает путь в бакете (его и хранит транзакция). */
export async function uploadOperationReceipt(
  file: PickedReceipt,
  tenantId: string | null,
): Promise<string> {
  if (!tenantId) throw new Error("Нет активного аккаунта");

  const mime = file.mimeType ?? "image/jpeg";
  if (!ALLOWED.has(mime)) {
    throw new Error("Подойдёт фотография или PDF");
  }
  if (file.size != null && file.size > MAX_BYTES) {
    throw new Error("Файл больше 10 МБ — сожмите или снимите заново");
  }

  // RN не знает File: читаем локальный uri в буфер, его supabase-js принимает.
  const res = await fetch(file.uri);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("Файл больше 10 МБ — сожмите или снимите заново");
  }

  const path = `${tenantId}/${randomUuid()}.${extOf(file)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Убирает файл из бакета. Зовётся ТОЛЬКО для того, что залили и тут же
 *  сняли: у сохранённой операции документ — часть истории. */
export async function deleteOperationReceipt(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

/** Подписанная ссылка на просмотр. Живёт 5 минут — ровно чтобы открыть. */
export function useSignedReceiptUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["operation-receipt", path],
    enabled: !!path,
    staleTime: (SIGNED_URL_TTL - 30) * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL);
      if (error) throw new Error(error.message);
      return data?.signedUrl ?? null;
    },
  }).data;
}
