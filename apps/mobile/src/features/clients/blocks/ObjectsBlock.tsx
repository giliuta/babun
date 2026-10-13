import { useMemo } from "react";
import { View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { SectionCard } from "@/components/ui/SectionCard";
import { Card } from "@/components/ui/Card";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { NavRow } from "@/components/ui/card-rows";
import { LocationRequestRow } from "@/features/clients/blocks/LocationRequestRow";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import {
  visibleLocationRequests,
  type LocationRequest,
} from "@/features/clients/location-request-link";
import { useLocationRequests } from "@/features/clients/location-requests";
import { objectTarget } from "@/features/clients/object-address";
import { useThemeColors } from "@/theme/colors";
import { useCopyValue } from "@/lib/copy-value";
import { moreLabel } from "@/features/clients/more-label";
import { ObjectNote } from "./objects-block/ObjectNote";
import { ObjectRow } from "./objects-block/ObjectRow";

// The row and the per-object note live in `objects-block/`; `ObjectRow` is
// re-exported here for the booking form, invoices and documents.
export { ObjectRow } from "./objects-block/ObjectRow";

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
              primary={ordered.length > 1 && !!loc.isPrimary}
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

  // «Ещё N» — объектов сверх показанного основного (03.10).
  const more = single && onOpenAll ? moreLabel(ordered.length) : null;
  return (
    <SectionCard
      title={bare ? undefined : "Объекты"}
      action={more && onOpenAll ? { label: more, pill: true, onPress: onOpenAll } : undefined}
    >
      {shown.map((loc, i) => {
        const row = (
          <>
            <ObjectRow
              loc={loc}
              separated={i > 0}
              teamId={client.team_id ?? null}
              primary={!single && ordered.length > 1 && !!loc.isPrimary}
              // Заметка стоит ПОД строкой своей плашкой — третьей строкой её
              // печатать больше не надо.
              showNote={!onNote}
              residents={residentsFor?.(loc)}
              lastVisit={lastVisitFor?.(loc)}
              onPress={
                single ? onOpenAll : onOpen ? () => onOpen(loc.id) : undefined
              }
              pressHint={single ? "Открывает все объекты клиента" : undefined}
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
