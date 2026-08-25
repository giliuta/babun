import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TimeRangePicker } from "@/components/ui/TimeWheel";
import { haptics } from "@/lib/haptics";

// Пара границ «С … До …» одним нижним листом — диалект «Своего периода»
// финансов (PeriodWheelsModal): сегмент С|До выбирает границу, ниже она
// крутится, «Применить» коммитит. Владелец 2026-08-16: «часы календаря —
// снизу, как время в финансах: с такого-то до такого-то».
//
// ГРАНИЦА СТАВИТСЯ ДВУМЯ БАРАБАНАМИ, А НЕ СПИСКОМ (владелец 2026-08-17: «не по
// списку, а именно тумблер: отдельно кручу часы, отдельно минуты, минуты в
// пятиминутку; дохожу до 24 — крутит дальше»). Список из 24 строк отвечал
// только на «который час» и не умел сказать «в половину девятого»: минуты в нём
// не существовали вовсе. Барабаны — `TimeWheelPair`, канонический контрол
// времени продукта; правки вида и поведения кольца — там, а не здесь.
//
// «АВТОМАТИЧЕСКИ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-08-17: «непонятно
// автоматическое — мы убираем полностью»). Тумблер прятал пару часов за словом,
// которое не отвечало на вопрос «а с какого же часа видно сетку»: человек
// открывал лист, чтобы НАЗВАТЬ часы, и первым делом видел переключатель,
// который эти часы скрывал. Пара 00:00–24:00 больше не сентинел — это ровно то,
// что написано: сутки целиком.

export interface HourRangeValue {
  start: number;
  end: number;
  startMinute?: number;
  endMinute?: number;
}

/** Минуты суток — в них удобно сравнивать границы, и только в них. */
function toMin(h: number, m: number): number {
  return h * 60 + m;
}

export function HourRangeSheet({
  visible,
  title,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  title: string;
  /** Текущая пара — читается буквально, включая минуты. */
  value: HourRangeValue;
  onClose: () => void;
  onApply: (v: {
    start: number;
    end: number;
    startMinute: number;
    endMinute: number;
  }) => void;
}) {
  const [start, setStart] = useState({ hour: 8, minute: 0 });
  const [end, setEnd] = useState({ hour: 20, minute: 0 });

  // Ресинк черновика — по фронту открытия (приём PeriodWheelsModal): рефетч
  // настроек не должен перескакивать границу, которую человек сейчас крутит.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setStart({ hour: value.start, minute: value.startMinute ?? 0 });
      setEnd({ hour: value.end, minute: value.endMinute ?? 0 });
    }
    wasVisible.current = visible;
  }, [visible, value]);

  const apply = () => {
    haptics.tap();
    onApply({
      start: start.hour,
      end: end.hour,
      startMinute: start.minute,
      endMinute: end.minute,
    });
    onClose();
  };

  // КОНЕЦ ОБЯЗАН БЫТЬ ПОЗЖЕ НАЧАЛА, и правит это лист, а не отказ сервера
  // (в базе то же правило стоит проверкой `calendar_settings_window_order_check`).
  // Двигаем МИНИМАЛЬНО — на один шаг барабана, а не «на час вперёд»: человек
  // крутил начало, а не конец, и переписывать ему конец сильнее необходимого
  // значит отобрать уже сделанный выбор.
  //
  // Половины пишутся ФУНКЦИОНАЛЬНО и порознь (`TimeWheelPair` для этого и
  // разделяет коллбэки): два коммита в одном батче React иначе теряют соседнее
  // значение.
  const changeStart = (patch: { hour?: number; minute?: number }) => {
    setStart((prev) => {
      const next = { ...prev, ...patch };
      setEnd((prevEnd) => {
        if (toMin(next.hour, next.minute) < toMin(prevEnd.hour, prevEnd.minute)) {
          return prevEnd;
        }
        const bumped = Math.min(24 * 60, toMin(next.hour, next.minute) + 5);
        return bumped >= 24 * 60
          ? { hour: 24, minute: 0 }
          : { hour: Math.floor(bumped / 60), minute: bumped % 60 };
      });
      return next;
    });
  };

  const changeEnd = (patch: { hour?: number; minute?: number }) => {
    setEnd((prev) => {
      const next = { ...prev, ...patch };
      setStart((prevStart) => {
        if (toMin(next.hour, next.minute) > toMin(prevStart.hour, prevStart.minute)) {
          return prevStart;
        }
        const bumped = Math.max(0, toMin(next.hour, next.minute) - 5);
        return { hour: Math.floor(bumped / 60), minute: bumped % 60 };
      });
      return next;
    });
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View className="px-5">
          <Button label="Применить" onPress={apply} />
        </View>
      }
    >
      <View className="px-5 pb-4">
        <TimeRangePicker
          start={start}
          end={end}
          onChangeStart={changeStart}
          onChangeEnd={changeEnd}
        />
      </View>
    </BottomSheet>
  );
}
