// СЧЕТА И ЧЕКИ КЛИЕНТА — строка рядом с «Документацией».
//
// Владелец 2026-08-09: документ «закрепляется за запись в календаре и также
// передаётся в документацию самого клиента». «Документация» — это то, что мы
// СЛОЖИЛИ про клиента (фото объекта, скан паспорта); счета и чеки — то, что
// МЫ ЕМУ ВЫДАЛИ, и путать их в одном счётчике нельзя: бухгалтеру нужны вторые.
//
// Своей страницы у строки нет — она ведёт в общие «Документы», суженные до
// этого клиента. Один список в двух вёрстках развалился бы на два разных
// продукта (закон «один дизайн на все списки»).

import { useMemo } from "react";
import { useRouter } from "expo-router";
import { NavRow } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";
import { useInvoices } from "@/features/invoices/queries";
import { useReceipts } from "@/features/documents/receipts-queries";

/** Склонение: «3 документа». */
function docsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "документ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "документа";
  return "документов";
}

export function ClientDocumentsRow({
  clientId,
  separated,
}: {
  clientId: string;
  separated?: boolean;
}) {
  const router = useRouter();
  const invoices = useInvoices();
  const receipts = useReceipts({ clientId });

  const count = useMemo(() => {
    const own = (invoices.data ?? []).filter((i) => i.client_id === clientId);
    return own.length + (receipts.data?.length ?? 0);
  }, [invoices.data, receipts.data, clientId]);

  const loading = invoices.data === undefined || receipts.data === undefined;

  return (
    <NavRow
      label="Счета и чеки"
      separated={separated}
      value={loading ? "Загрузка…" : count > 0 ? `${count} ${docsWord(count)}` : null}
      // Пусто — строка остаётся: отсюда видно, что клиенту ещё ничего не
      // выписывали, и туда же ведёт дорога, когда выпишут.
      placeholder="пока нет"
      onPress={() => {
        haptics.tap();
        router.push({ pathname: "/documents", params: { clientId } });
      }}
    />
  );
}

export default ClientDocumentsRow;
