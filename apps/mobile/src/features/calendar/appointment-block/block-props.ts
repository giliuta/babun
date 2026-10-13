import type { Appointment } from "@babun/shared/local/appointments";
import type { PlacedAppt } from "@/features/calendar/layout";
import type { BlockColors } from "@/features/calendar/status-colors";

export type AppointmentBlockProps = {
  placed: PlacedAppt;
  /** Committed pixels-per-hour — px math (drag snap, text fit) only;
   *  the on-screen geometry is percent-based and zoom-independent. */
  hourH: number;
  laneW: number;
  startHour: number;
  endHour: number;
  stepMinutes: number;
  colors: BlockColors;
  /** Цвет чужой метки: точка в правом нижнем углу, затемнённая против
   *  ЗАЛИВКИ блока. null — метка своя. */
  offLabelColor: string | null;
  /** Высота строки текста при текущем системном шрифте. Считается ОДИН раз в
   *  колонке: `useWindowDimensions` внутри каждого из полутора сотен блоков
   *  недели стоил бы кадра. */
  lineH: number;
  label: string;
  service: string | null;
  /** Куда ехать: снимок адреса записи, иначе адрес клиента. null — адреса
   *  нет, и тогда оранжевый блок «нет объекта» называет дыру пустотой. */
  address: string | null;
  /** Запланирована, а время уже прошло — незакрытая работа, то есть
   *  недополученные деньги. Сигнал ОДИН: кант вдвое толще (2pt против 1). Ни
   *  своего цвета, ни углового знака у просрочки нет — кант остаётся цветом
   *  записи, а почему именно так, объяснено в `status-colors`. */
  overdue?: boolean;
  /** Запись в режиме правки («Двигать и растягивать» из меню): только тогда
   *  её можно тащить и тянуть за края. В покое запись закреплена. */
  editing?: boolean;
  /** Ширина колонки дня в Неделе: в свободном перемещении запись ходит и
   *  по дням — шагом в колонку. В Дне не задана: там одна колонка. */
  dayW?: number;
  onEdit: (a: Appointment) => void;
  /** Место в стопке узкой колонки (`decksFor`): номер снизу и размер.
   *  Числами, а не объектом, — чтобы `memo` сравнивал по значению. */
  deckIndex?: number;
  deckSize?: number;
  /** Долгое нажатие — меню записи. Двигать и растягивать — только после
   *  выбора этого в меню (владелец 2026-09-24: «просто так тянуть нельзя,
   *  она зафиксирована; зажимаешь — окно, выбрал — тогда можно»). */
  onMenu?: (a: Appointment) => void;
  /** Undefined for crew: the block stays tappable but has no drag affordance. */
  onReschedule?: (a: Appointment, s: string, e: string, date?: string) => void;
};
