import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { House, MapPin, MoreHorizontal, Tag, UserRound } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { SectionCard } from "@/components/ui/SectionCard";
import { Card } from "@/components/ui/Card";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { NavRow } from "@/components/ui/card-rows";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { LocationRequestRow } from "@/features/clients/blocks/LocationRequestRow";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import {
  visibleLocationRequests,
  type LocationRequest,
} from "@/features/clients/location-request-link";
import { useLocationRequests } from "@/features/clients/location-requests";
import { addressLines, objectTarget, routeAddress } from "@/features/clients/object-address";
import { formatShortDateRu } from "@/features/clients/format";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useCopyValue } from "@/lib/copy-value";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { PICKER_RADIUS } from "@/components/ui/picker-grid";
import { useLocationLabels } from "@/features/settings/local-settings";
import { objectTypeKey } from "@/features/clients/object-types";

// ОБЪЕКТЫ на карточке клиента.
//
// Владелец 2026-07-27: «первая строчка — не пишешь „тип объекта", а просто:
// я выбрал дом — значит Дом; потом чёткая адресная ссылка и чётко заметка.
// Всё кратенько в три строчки. И небольшая кнопка навигации: нажимаю —
// вылазит снизу шторка, и оно определяет Google, Waze, Яндекс».
//
// Поэтому строка объекта — не «ярлык · значение», а КАРТОЧКА АДРЕСА в три
// строки: что это → куда ехать → когда снова и как войти. Тип идёт сам по
// себе (он и есть имя объекта), адрес крупнее, третья строка делится между
// сроком обслуживания и заметкой через «·» — четвёртый этаж поднимал строку
// до ~86pt и ломал ритм списка.
//
// Тап по строке ОТКРЫВАЕТ ЛИСТ ПРАВКИ, а не страницу (владелец 2026-08-06:
// «отдельная страница объекта вообще не открывается… если нажимаешь —
// вылазит менюшка по поводу редактирования»). Шеврона поэтому нет: он обещал
// бы этаж навигации, которого больше не существует.
//
// Удаление — СМАХНУТЬ ВЛЕВО (тот же жест, что у номеров в Контактах). Кнопки
// удаления в строке нет: она занимала бы место всегда и смыкалась зоной с
// кнопкой маршрута — именно так палец однажды делал не то, во что целился.

const EMPTY_REQUESTS: LocationRequest[] = [];

/** МИНИ-ЗАМЕТКА ОБЪЕКТА — ТА ЖЕ ПЛАШКА, ЧТО У ЗАМЕТКИ ЗАПИСИ (владелец
 *  22.09: «в записи мы выбираем объект, и там снизу сразу заметка; сделай
 *  такую же у клиента — под каждым объектом своя»). Своим компонентом, а не
 *  в цикле: у каждой плашки свой черновик и своя запись по уходу с поля. */
function ObjectNote({
  loc,
  ownerKey,
  onSave,
}: {
  loc: Location;
  ownerKey: string;
  onSave: (id: string, next: string) => void;
}) {
  const note = useInlineNote<string>(
    loc.note ?? "",
    loc.id,
    (next, id) => onSave(id, next),
    ownerKey,
  );
  // Без выноса (30.09): у сотрудника чужой компании меню «Скопировать» нет.
  const caps = useClientsCapabilities();
  return (
    <InlineNoteField
      note={note}
      placeholder="Заметка объекта"
      accessibilityLabel={`Заметка объекта ${loc.label || loc.address || ""}`.trim()}
      maxLength={500}
      noCopy={!caps.export}
    />
  );
}

/** Плитка объекта — того же размера, что плитка записи в «Истории»
 *  (`SelectRow`, 28): рядом на карточке они не должны различаться
 *  (владелец 03.10: «значки отличаются прям»). */
const OBJECT_TILE = 28;

/** ПЛИТКА ТИПА ОБЪЕКТА — ТА ЖЕ, ЧТО У ТИПА В ЛИСТЕ ОБЪЕКТА (владелец 03.10:
 *  «иконка и цвет от типа объекта переходят сюда полноценно»). Правило
 *  блока «Тип объекта» (`ObjectFields`): цвет типа, а без него акцент;
 *  значок типа, а без него ярлык. Тип не выбран — светлый домик. */
function ObjectTypeTile({ typed, color, icon }: { typed: boolean; color?: string | null; icon?: string | null }) {
  const t = useThemeColors();
  if (typed) {
    return <AppearanceTile color={color ?? t.accent} icon={icon ?? null} fallback={Tag} size={OBJECT_TILE} />;
  }
  return (
    <View
      style={{
        // Та же геометрия, что у `AppearanceTile` (владелец 03.10: домик
        // «отличается размером — не очень аккуратно»): радиус и глиф 56 %.
        width: OBJECT_TILE,
        height: OBJECT_TILE,
        borderRadius: PICKER_RADIUS,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.accent}14`,
      }}
    >
      <House color={t.accent} size={Math.round(OBJECT_TILE * 0.56)} strokeWidth={2} />
    </View>
  );
}

export default function ObjectsBlock({
  client,
  onOpen,
  onDelete,
  onAdd,
  requestsEnabled = false,
  residentsFor,
  lastVisitFor,
  canCopy = true,
  onNote,
  limit,
  onOpenAll,
  bare,
  only,
}: {
  client: Client;
  /** КАРТОЧКА — ОДИН ОБЪЕКТ (владелец 03.10: «видно только последний —
   *  обслуженный или добавленный; нажимаю — открывается страница со всеми»).
   *  Показывается только он, с заметкой; тап по нему — страница объектов
   *  (`onOpenAll`), без свайпа. Объектов нет — дверь «Добавить объект». */
  only?: string | null;
  /** На своей странице шапки у блока нет: название уже в заголовке экрана. */
  bare?: boolean;
  /** Сколько строк показывать; больше — за дверью «Все объекты · N». */
  limit?: number;
  /** Открыть страницу всех объектов (дверь под списком). */
  onOpenAll?: () => void;
  /** Записать заметку объекта. Нет — плашек заметок под строками нет
   *  (форма записи: там заметка объекта своя и живёт в самой записи). */
  onNote?: (locId: string, next: string) => void;
  /** Открыть лист правки этого объекта. Нет — строка только читается
   *  (сотрудник без «Клиенты: Меняет»: сервер правку откажет). */
  onOpen?: (locId: string) => void;
  /** Удалить объект (спрашивает подтверждение сама карточка). Нет — свайпа
   *  «Удалить» нет. */
  onDelete?: (loc: Location) => void;
  /** Открыть лист добавления. Работает и в черновике: объект пишется в тот же
   *  черновик, поэтому пригашать строку больше не нужно. Нет — двери нет. */
  onAdd?: () => void;
  /** Показывать ссылки «отметьте адрес», отправленные клиенту (STORY-077).
   *  Только у сохранённого клиента и у владельца/диспетчера: черновику
   *  ссылку не выписать, а мастеру таблица по RLS не видна. */
  requestsEnabled?: boolean;
  /** Кто живёт на объекте — «Мария Спиру · жилец, Андреас · жилец»
   *  (STORY-086: управляющая даёт виллы, в виллах жильцы). Нет — строки
   *  жильцов нет.
   *
   *  ТОЛЬКО ПОКАЗАНИЕ. Ни роль отсюда не правится, ни жилец не заводится:
   *  дверь «Добавить жильца» стоит ОДНА — в листе самой виллы, где вопрос
   *  «кто здесь живёт» и задаётся (ТЗ, «что НЕ делаем» 3). Под каждым
   *  объектом страницы она была бы десятью одинаковыми акцентными строками
   *  при нуле жильцов у управляющей с десятью виллами. */
  residentsFor?: (loc: Location) => string | undefined;
  /** Дата последнего визита на объект (YYYY-MM-DD) — «был 12 авг» в третьей
   *  строке. Считает карточка клиента (`object-last-visit.ts`); у записи и
   *  инвойса пропа нет, и строки «был» там нет: там объект выбирают, а не
   *  вспоминают. */
  lastVisitFor?: (loc: Location) => string | undefined;
  /** Долгое нажатие копирует адрес. Нет — не копирует: клиент чужой
   *  компании не выносится из приложения (владелец 30.09). */
  canCopy?: boolean;
}) {
  const t = useThemeColors();
  // ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС»: пока клиент не ответил, в списке стоит
  // строка «Ждём адрес» — место объекта, которого ещё нет. Ответил — строка
  // уходит, объект приезжает обычной строкой (см. useLocationRequests).
  const { data: requests = EMPTY_REQUESTS } = useLocationRequests(
    requestsEnabled ? client.id : null,
  );
  const requestActions = useLocationRequestActions();
  const copy = useCopyValue();
  const shownRequests = useMemo(() => visibleLocationRequests(requests), [requests]);
  // Основной первым: при записи подставляется он, и в списке он должен
  // читаться первым. Бейджа «основной» нет — порядок и есть признак.
  const ordered = useMemo(
    () =>
      [...(client.locations ?? [])].sort(
        (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
      ),
    [client.locations],
  );

  const single = only !== undefined;
  const shown = single
    ? ordered.filter((loc) => loc.id === only)
    : limit
      ? ordered.slice(0, limit)
      : ordered;
  const rest = single ? 0 : ordered.length - shown.length;
  // Без объектов и без права добавлять смотреть нечего: блока нет, а не
  // пустая карточка с одной шапкой.
  if (ordered.length === 0 && shownRequests.length === 0 && !onAdd) return null;

  // СВОЯ СТРАНИЦА — КАЖДЫЙ ОБЪЕКТ ОТДЕЛЬНОЙ КАРТОЧКОЙ (владелец 03.10:
  // «компактно и раздели их между собой»; выбран вариант 1): слева плитка
  // вида типа объекта, справа маршрут, под строкой — заметка, которую правят
  // прямо здесь («мне нужны заметки, чтобы быстро редактировать»).
  if (bare) {
    return (
      <View style={{ gap: 10, paddingTop: 4 }}>
        {shown.map((loc) => {
          const row = (
            <ObjectRow
              loc={loc}
              teamId={client.team_id ?? null}
              // Заметка правится прямо здесь — третьей строкой её не печатаем.
              showNote={!onNote}
              residents={residentsFor?.(loc)}
              lastVisit={lastVisitFor?.(loc)}
              onPress={onOpen ? () => onOpen(loc.id) : undefined}
              onLongPress={canCopy && objectTarget(loc) ? () => copy(objectTarget(loc)) : undefined}
            />
          );
          // Заметка правится прямо здесь, в серой плашке (вариант 1, 03.10).
          const note = onNote ? <ObjectNote loc={loc} ownerKey={client.id} onSave={onNote} /> : null;
          return (
            <Card key={loc.id} style={{ marginHorizontal: 16 }}>
              {onDelete ? (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  onAction={() => onDelete(loc)}
                  accessibilityLabel={`Удалить объект ${loc.label || ""}`.trim()}
                >
                  {row}
                </SwipeRow>
              ) : (
                row
              )}
              {note}
            </Card>
          );
        })}
        {shownRequests.length > 0 ? (
          <Card style={{ marginHorizontal: 16 }}>
            {shownRequests.map((request, i) => (
              <LocationRequestRow
                key={request.id}
                request={request}
                separated={i > 0}
                onPress={() => void requestActions.menu(request)}
              />
            ))}
          </Card>
        ) : null}
        {onAdd ? (
          <Card style={{ marginHorizontal: 16 }}>
            <ChooseRow compact icon={MapPin} label="Добавить объект" onPress={onAdd} />
          </Card>
        ) : null}
      </View>
    );
  }

  return (
    <SectionCard title={bare ? undefined : "Объекты"}>
      {shown.map((loc, i) => {
        const row = (
          <>
            <ObjectRow
              loc={loc}
              separated={i > 0}
              teamId={client.team_id ?? null}
              // Заметка стоит ПОД строкой своей плашкой — третьей строкой её
              // печатать больше не надо.
              showNote={!onNote}
              residents={residentsFor?.(loc)}
              lastVisit={lastVisitFor?.(loc)}
              onPress={
                single ? onOpenAll : onOpen ? () => onOpen(loc.id) : undefined
              }
              // Долгое нажатие копирует адрес (нет адреса — ссылку на карту):
              // его пересылают бригаде или вставляют в навигатор.
              onLongPress={canCopy && objectTarget(loc) ? () => copy(objectTarget(loc)) : undefined}
            />
            {/* ЗАМЕТКА ПРИШИТА К ОБЪЕКТУ (владелец 03.10: «везде, где ставится
                этот блок, там сразу и заметка объекта») — и на карточке. */}
            {onNote ? (
              <ObjectNote loc={loc} ownerKey={client.id} onSave={onNote} />
            ) : null}
          </>
        );
        // Без права удалять свайпа нет вовсе: жест, который кончится отказом
        // сервера, хуже отсутствующего.
        return onDelete && !single ? (
          <SwipeRow
            key={loc.id}
            label="Удалить"
            color={t.danger}
            onAction={() => onDelete(loc)}
            accessibilityLabel={`Удалить объект ${loc.label || ""}`.trim()}
          >
            {row}
          </SwipeRow>
        ) : (
          <View key={loc.id}>{row}</View>
        );
      })}
      {/* Пустого состояния нет: при нуле объектов группа — одна эта строка.
          Добавление открывается ЛИСТОМ снизу (владелец 2026-07-27), а не
          страницей: три поля не стоят экрана поверх экрана, и объектов подряд
          заводят несколько. */}
      {/* ОСТАЛЬНЫЕ — НА СВОЕЙ СТРАНИЦЕ (владелец 22.09): двенадцать объектов
          в карточке пришлось бы пролистывать до файлов. */}
      {rest > 0 && onOpenAll ? (
        <NavRow
          label="Все объекты"
          value={String(ordered.length)}
          separated
          onPress={onOpenAll}
        />
      ) : null}
      {shownRequests.map((request, i) => (
        <LocationRequestRow
          key={request.id}
          request={request}
          separated={ordered.length + i > 0}
          onPress={() => void requestActions.menu(request)}
        />
      ))}
      {/* ТА ЖЕ ДВЕРЬ, ЧТО В ЗАПИСИ (сведено 2026-09-10). Здесь стоял `AddRow`:
          без кружка со значком и с волоском сверху. Владелец 2026-09-09,
          поймав это на записи: «почему тут изменилась архитектура, если она
          должна быть другой — как у нас принято». Один вопрос — одна дверь. */}
      {onAdd && !(single && ordered.length > 0) ? (
        <ChooseRow compact icon={MapPin} label="Добавить объект" onPress={onAdd} />
      ) : null}
    </SectionCard>
  );
}

// СТРОКА ОБЪЕКТА ОТКРЫТА НАРУЖУ (2026-08-31). Форма записи показывала объекты
// клиента ЧИПАМИ — одно слово в пилюле, без адреса, без срока ТО, без заметки.
// Владелец: «блок объекта должен быть такой же, как в клиентах». Не похожий —
// ТОТ ЖЕ: скопированная карточка адреса разошлась бы с оригиналом на первой же
// правке, как разошлись две формы записи.
export function ObjectRow({
  loc,
  separated,
  onMore,
  showNote = true,
  residents,
  lastVisit,
  onPress,
  onLongPress,
  teamId = null,
}: {
  loc: Location;
  separated?: boolean;
  /** Кружок «…» в хвосте строки — правка ЭТОГО объекта (форма записи, где
   *  сам тап по строке меняет объект). Стрелки справа нет нигде: владелец
   *  2026-09-04 — «эти стрелочки убираем, ставим красивую иконку, при тапе на
   *  неё открывается редактирование объекта». На карточке клиента правку
   *  открывает сам тап, и кружка там нет. */
  onMore?: () => void;
  /** Заметка третьей строкой. Запись выключает: у неё заметка объекта стоит
   *  своей плашкой под строкой, и третья строка дублировала бы её. */
  showNote?: boolean;
  /** Жильцы объекта одной строкой — «Мария Спиру · жилец, Андреас · жилец».
   *  Четвёртый этаж строки, со значком человека: без него перечень имён
   *  читался бы продолжением заметки. */
  residents?: string;
  /** Последний визит на объект, YYYY-MM-DD. Печатается «был 12 авг» в той же
   *  третьей строке, что заметка, — не четвёртым этажом. */
  lastVisit?: string;
  /** Нет — строка только читается (STORY-084: в записи объект человеку не
   *  меняется). Маршрут при этом остаётся: это дорога, а не правка. */
  onPress?: () => void;
  /** Долгое нажатие по строке — на карточке клиента копирует адрес. Запись и
   *  инвойс его не передают: там строка ведёт свой сценарий выбора. */
  onLongPress?: () => void;
  /** Команда клиента — её «Карты для маршрута» (у каждой команды свои). */
  teamId?: string | null;
}) {
  const t = useThemeColors();
  const target = objectTarget(loc);
  // ТИП ОБЪЕКТА — ТОЛЬКО ЗНАЧКОМ (владелец 03.10: «слово не пишем — тип
  // обозначает иконка: цвет и значок из „Типов объектов“; типа нет — домик»).
  const { data: labelPresets = [] } = useLocationLabels(teamId);
  const typed = !!loc.label?.trim();
  const type = typed
    ? labelPresets.find((l) => objectTypeKey(l.name) === objectTypeKey(loc.label))
    : undefined;
  // Адрес двумя строками: улица и дом — чёрным, уточнение — мелко серым.
  const lines = addressLines(loc);
  const note = showNote ? (loc.note ?? "").trim() : "";
  const people = (residents ?? "").trim();
  // «БЫЛ 12 АВГ» ДЕЛИТ ТРЕТЬЮ СТРОКУ С ЗАМЕТКОЙ через «·» — формат тот же,
  // что «был 30 мая» в сводке. Дата ПЕРВОЙ: строка одна и режется хвостом,
  // короткая дата должна уцелеть, а длинная заметка — обрезаться.
  const visited = lastVisit ? `был ${formatShortDateRu(lastVisit)}` : "";
  const thirdLine = [visited, note].filter(Boolean).join(" · ");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        minHeight: 60,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={!onPress && !onLongPress}
        accessible
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={[
          loc.label || "Объект",
          target,
          visited,
          note,
          // Перечень имён без слова «жильцы» VoiceOver прочитал бы как
          // продолжение заметки: значок он не озвучивает.
          people ? `Жильцы: ${people}` : "",
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint={
          !onPress
            ? undefined
            : onMore
              ? "Открывает выбор объекта"
              : "Открывает правку объекта"
        }
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed && onPress ? 0.6 : 1,
        })}
      >
        <View style={{ marginRight: 4 }}>
          <ObjectTypeTile typed={typed} color={type?.color} icon={type?.icon} />
        </View>
        <View style={{ flex: 1 }}>
          {/* АДРЕС — ГЛАВНАЯ СТРОКА (владелец 03.10): едут по адресу, тип
              объекта говорит плитка слева. Улица и дом — чёрным, точный адрес
              (комплекс, подъезд, этаж, квартира, город) — под ним мелко серым. */}
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: lines.main ? "500" : "400",
              color: lines.main ? t.ink : t.faint,
            }}
          >
            {lines.main || "адрес не указан"}
          </Text>
          {lines.detail ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {lines.detail}
            </Text>
          ) : null}
          {/* ТРЕТЬЯ СТРОКА — «был 12 авг · код домофона». Срок обслуживания
              делил её через «·», пока у объекта был интервал; сам интервал
              снесён 2026-09-04 (владелец: «сделаем лучше в напоминаниях»).
              Нет заметки — строка из одной даты; нет обоих — строки нет. */}
          {thirdLine ? (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {thirdLine}
            </Text>
          ) : null}
          {people ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <UserRound color={t.faint} size={12} strokeWidth={2.2} />
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 13, color: t.sub }}
              >
                {people}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* Маршрут — отдельное действие над адресом этой строки; шторка выбора
          карты приезжает снизу (chooseOption → канонический лист). */}
      <ObjectRouteButton
        mapUrl={loc.mapUrl}
        // Объект с частями едет по геокодируемой части адреса: подъезд, этаж и
        // квартира карте только мешают.
        address={routeAddress(loc)}
        label={loc.label}
        teamId={teamId}
      />

      {/* Правка объекта — кружок в хвосте, СНАРУЖИ нажимаемой области строки
          (иначе VoiceOver склеит их в один элемент). */}
      {onMore ? (
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel={`Правка объекта ${loc.label || "Объект"}`}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            backgroundColor: t.rowFill,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <MoreHorizontal color={t.body} size={ICON.sm} />
        </Pressable>
      ) : null}
    </View>
  );
}
