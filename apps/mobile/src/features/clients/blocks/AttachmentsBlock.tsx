// ДОКУМЕНТАЦИЯ на карточке — ОДНА СТРОКА, дверь на страницу (владелец
// 2026-08-03: «полноценно открывается страница, где вся документация о
// клиенте — все документы, чеки, инвойсы, фотографии»).
//
// Живёт СТРОКОЙ В БЛОКЕ «ЗАМЕТКИ» (владелец 2026-08-06: «документация пусть
// будет тоже в заметках»): и то и другое — то, что мы ЗНАЕМ о клиенте, а не
// то, чем он является. Своей карточки у строки нет — потому это `Row`, а не
// блок с `RowGroup`.
//
// Слово «Вложения» ушло: оно про механику («что-то приложили»), а не про
// смысл. «Документация» называет содержимое, и перечислять «документы, чеки,
// фото» в подписи больше не нужно — справа стоит счётчик файлов.
//
// Файл принадлежит КЛИЕНТУ: путь в хранилище строится по его id, поэтому в
// черновике строки нет вовсе (см. ClientProfileBlocks).

import { useRouter } from "expo-router";
import { useClientAttachments } from "@/features/clients/card-attachments";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClientVisitPhotos } from "@/features/clients/visit-photos";
import { NavRow } from "@/components/ui/card-rows";
import { haptics } from "@/lib/haptics";

/** Склонение: «3 файла». */
function filesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "файла";
  return "файлов";
}

export function AttachmentsRow({
  clientId,
  separated,
}: {
  clientId: string;
  /** Разделитель сверху: строка идёт последней в чужой карточке. */
  separated?: boolean;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useClientAttachments(clientId);
  // Фото с выездов лежат в своей таблице, но на странице показываются вместе
  // с документами — значит и в счётчике они тоже. Иначе у клиента с одними
  // «до/после» строка обещала пустоту, а страница открывалась полной.
  const { data: appointments = [] } = useClientAppointments(clientId);
  const { data: visitPhotos = [] } = useClientVisitPhotos(
    clientId,
    appointments.map((a) => a.id),
  );
  const count = (data?.items.length ?? 0) + visitPhotos.length;

  return (
    <NavRow
      label="Документация"
      separated={separated}
      value={
        isLoading
          ? "Загрузка…"
          : isError
            ? "Не удалось загрузить"
            : count > 0
              ? `${count} ${filesWord(count)}`
              : null
      }
      // Пусто — строка всё равно нужна: это единственная дверь к добавлению
      // (раньше блок скрывался целиком и приложить первый файл было нечем).
      placeholder="файлы"
      onPress={() => {
        haptics.tap();
        router.push({
          pathname: "/clients/attachments",
          params: { clientId },
        });
      }}
    />
  );
}

export default AttachmentsRow;
