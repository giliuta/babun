import type { Appointment } from "@babun/shared/local/appointments";
import { tintOver } from "@/components/ui/color-contrast";
import {
  autoBaseColor,
  recordFilled,
  resolveRecordColor,
  serviceBaseColor,
  type ColorSituation,
  type RecordColorInput,
} from "@/features/appointments/record-color";

export function bookTitle(isEdit: boolean, kind: "work" | "event"): string {
  return isEdit
    ? kind === "event"
      ? "Событие"
      : "Запись"
    : kind === "event"
      ? "Событие"
      : "Новая запись";
}

// ПОДСВЕТКА, А НЕ ЗАЛИВКА (владелец 2026-09-07: «не прям жёлтая… плавная,
// не ядовитая, красивая подсветка»). Сплошные 38 % красили страницу целиком;
// теперь цвет записи стоит у шапки на 22 % и мягко сходит на нет к середине
// экрана (PageWash), низ страницы и футер — обычный холст.
export const WASH = 0.22;

export interface BookChromeInput {
  kind: "work" | "event";
  eventColor: string | null;
  colorOverride: string | null;
  autoColorRule: Parameters<typeof autoBaseColor>[0];
  teamColor: string | null | undefined;
  labelColor: string | null | undefined;
  serviceIds: string[];
  serviceColorById: Map<string, string | null>;
  editing: Appointment | null;
  date: string;
  clientId: string | null;
  locationId: string | null;
  address: string;
  customTotal: boolean;
  effectiveTotal: number;
  todayYmd: string;
  situationPalette: RecordColorInput["palette"];
  activeSituations: ColorSituation[];
  fallbackColor: string;
  accent: string;
  canvas: string;
}

// ── identity-цвет записи → живая подсветка всего экрана ──
// Цвет записи — тот же, что станет блоком в календаре. Он владеет только
// ХРОМОМ (подложка, шапка-halo, градиент CTA, образец в углу); семантические
// токены (зелёный/красный/янтарь) и белые карточки не трогает.
export function bookChrome(input: BookChromeInput) {
  const { kind, eventColor, colorOverride, editing, todayYmd } = input;
  const picked = kind === "event" ? eventColor : colorOverride;
  /** Цвет выбран РУКОЙ — для озвучки и для листа выбора, не для покраски. */
  const hasColor = picked != null;
  // ЦВЕТ ЗАПИСИ — ОДНО ПРАВИЛО С КАЛЕНДАРЁМ (`record-color`): рука человека,
  // потом первая незакрытая дыра из палитры, потом «обычный» цвет по
  // настройке. Форма обязана показывать ровно то, что покажет сетка.
  //
  // Считается ДВАЖДЫ и по одному правилу: с выбранным цветом — это цвет
  // записи, и им красится всё; без него — цвет, который ДЕЙСТВОВАЛ БЫ, и его
  // показывает кнопка «Автоматически» в листе. Иначе выбор идёт вслепую:
  // слово обещает, что цвет подставят, и умалчивает какой.
  const autoBase = autoBaseColor(input.autoColorRule, {
    team: input.teamColor,
    label: input.labelColor,
    // Источник — живой черновик, поэтому шапка перекрашивается прямо в момент
    // выбора услуги, а кнопка «Автоматически» в листе цвета показывает то, что
    // встанет в сетке.
    service: serviceBaseColor(
      { service_ids: input.serviceIds },
      (id) => input.serviceColorById.get(id),
    ),
  });
  const identityFor = (override: string | null) =>
    kind === "work"
      ? resolveRecordColor({
          override,
          filled: recordFilled(
            {
              // Деньги — у сохранённой записи (леджер, аванс, статус оплаты).
              ...(editing ?? {}),
              kind: "work",
              date: input.date,
              client_id: input.clientId,
              location_id: input.locationId,
              address: input.address,
              service_ids: input.serviceIds,
              custom_total: input.customTotal,
              total_amount: input.effectiveTotal,
            },
            todayYmd,
          ),
          base: autoBase,
          palette: input.situationPalette,
          active: input.activeSituations,
          fallback: input.fallbackColor,
        })
      : // Событие: без палитры «чего не хватает», но по тому же правилу, что
        // и сетка (`autoBaseColor`), — иначе цвет формы и блока расходился.
        override ?? autoBase ?? input.accent;
  const identityC = identityFor(picked);
  /** Что подставится, если руками не выбирать. */
  const identityAuto = identityFor(null);
  // ЭКРАН КРАСИТСЯ ДЕЙСТВУЮЩИМ ЦВЕТОМ, А НЕ ТОЛЬКО ВЫБРАННЫМ РУКОЙ (владелец
  // 2026-09-05: «если я выбираю „Автоматически“ — значит подсвечивается именно
  // тем цветом, который сейчас стоит в автоматическом режиме»).
  //
  // Раньше карточки шапки брали `identityC` — полное правило записи, — а
  // подложка, шапка, halo, градиент кнопки и образец в углу брали «только
  // выбранный руками». Запись без клиента выходила серой в трёх карточках и
  // кобальтовой во всём остальном: один предмет двух цветов. Правило одно, и
  // цвет у записи есть ВСЕГДА — выбранный, ситуационный, командный или
  // запасной, — поэтому и гасить подсветку не от чего.
  // ЦВЕТНЫМ СТАНОВИТСЯ ТОЛЬКО ЗАДНИЙ ФОН (владелец 2026-09-07: «верхние блоки —
  // такие же обычные блоки, как клиент; оставь их как было, делай только
  // задний фон цветным, и всё»). Подложка страницы берёт цвет записи в
  // полную видимую силу (38 % поверх холста: белые карточки читаются, а
  // страница — оранжевая, а не «чуть тёплая»); шапка того же тона, чтобы блок
  // цвета шёл от статус-бара до кнопки. Карточки не трогаются.
  const groundBg = input.canvas;
  const headerBg = tintOver(identityC, input.canvas, WASH);
  const headerBorder = tintOver(identityC, input.canvas, 0.36);
  return { picked, hasColor, identityC, identityAuto, groundBg, headerBg, headerBorder };
}
