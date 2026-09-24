import { useCallback } from "react";
import { Clipboard } from "react-native";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";

// ДОЛГОЕ НАЖАТИЕ КОПИРУЕТ ЗНАЧЕНИЕ СТРОКИ — телефон, адрес объекта,
// реквизиты. Номер и адрес чаще всего нужны В ДРУГОМ приложении (WhatsApp
// бригаде, навигатор, банк), и выделять их пальцем в строке, которая по тапу
// открывает правку, нечем.
//
// БУФЕР — `Clipboard` ИЗ ЯДРА react-native, как у копирования сообщения в
// чате. `expo-clipboard` в зависимостях нет, а новые нативные пакеты не
// ставятся: dev-клиент собран без них, и модуль уронил бы приложение на
// старте. Ядро помечено устаревшим, но в 0.81 модуль на месте (iOS
// `RCTClipboard`, в вебе — react-native-web). Читается ЛЕНИВО, в момент
// копирования: геттер ядра печатает предупреждение, и печатать его на каждом
// открытии карточки незачем.

/** Копировать текст в буфер: лёгкий отклик пальцу и тост «Скопировано».
 *  Пустое не копируется — буфер человека не затирается пустотой. */
export function useCopyValue(): (text: string) => void {
  const toast = useToast();
  return useCallback(
    (text: string) => {
      const value = (text ?? "").trim();
      if (!value) return;
      try {
        Clipboard.setString(value);
      } catch {
        haptics.error();
        toast("Не удалось скопировать", "error");
        return;
      }
      haptics.impact();
      toast("Скопировано");
    },
    [toast],
  );
}
