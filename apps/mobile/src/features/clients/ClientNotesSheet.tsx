import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import NotesBlock from "@/features/clients/blocks/NotesBlock";

// ЗАМЕТКИ КЛИЕНТА — ЛИСТОМ ИЗ ЗАПИСИ (владелец 2026-09-03: «под клиентом
// маленькая плашка заметки»). Плашка на форме записи показывает последнюю
// заметку, тап открывает ЭТОТ лист — и в нём тот же блок, что на карточке
// клиента: композер сверху, датированный журнал под ним. Второго редактора
// заметок не заводим: разошёлся бы с карточкой на первой правке.
//
// Заголовок несёт лист (он внутри жеста грабера и в роторе VoiceOver), а у
// блока свой капс-ярлык выключен — иначе слово «Заметки» стояло бы дважды.
// Подсказки под пустым журналом здесь нет: человек пришёл по «Добавить
// заметку» и объяснять ему, что такое заметка, незачем.
//
// У листа нет футера, поэтому нижний безопасный отступ платит сам контент —
// иначе последняя заметка и её «✕» ложились бы на полосу home-индикатора.
//
// ИЗВЕСТНЫЙ ПРЕДЕЛ: `BottomSheet` размонтирует содержимое после ухода, и
// очередь записей блока рождается заново на каждое открытие. Две правки
// подряд быстрее, чем доезжает список клиентов (~полсекунды), могут
// затереть друг друга — та же щель, что при быстром выходе-входе в карточку.
export function ClientNotesSheet({
  visible,
  client,
  update,
  onClose,
}: {
  visible: boolean;
  client: Client;
  /** Единый persist-путь карточки клиента: PATCH `notes`. */
  update: (patch: Partial<Client>) => Promise<boolean>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Заметки клиента"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={0.85}
    >
      <View style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <NotesBlock client={client} update={update} title={null} showHint={false} />
      </View>
    </BottomSheet>
  );
}
