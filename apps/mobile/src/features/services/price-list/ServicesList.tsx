import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { Briefcase } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { ServiceSheet } from "@/features/services/ServiceSheet";
import { ROW_H, ServicePriceRow } from "./ServicePriceRow";
import { useServicesList } from "./use-services-list";

// УСЛУГИ — ПРАЙС-ЛИСТ, А НЕ КАРТОТЕКА: просто выбирается услуга, свайп вправо
// и свайп влево.
//
// КАТЕГОРИЙ НЕТ. `service_categories` пуста у всех тенантов, а читал её ровно
// один экран — этот. Это была бы вторая таксономия поверх работающей первой:
// услуги уже делятся тем, КТО их делает, и вот её выбор услуги при записи
// реально использует. Ориентир в длинном прайсе даёт не коробка, а порядок,
// который человек задаёт сам — перетаскиванием (`position`).
//
// ЦВЕТ У УСЛУГИ ЕСТЬ, И ЕГО ЧИТАЕТ КАЛЕНДАРЬ. Точка слева от имени — та же, что
// у метки и у команды (`NameColorField`), и она же становится цветом записи,
// когда в Кабинете → «Запись» выбран «Обычный цвет: Цвет услуги» (запись берёт
// цвет своей первой услуги). Второго места, где спрашивают цвет услуги, в
// продукте быть не должно.
//
// Экран переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/services — весь прайс,
//  · та же дверь есть в настройках календаря.
export function ServicesList({ teamId }: { teamId?: string } = {}) {
  const t = useThemeColors();
  const list = useServicesList(teamId);
  const {
    servicesQuery,
    teams,
    reorder,
    editing,
    setEditing,
    dragging,
    setDragging,
    activeTeamId,
    activeTeam,
    readOnly,
    teamsUnknown,
    templates,
    services,
    alertError,
    handleSave,
    busy,
  } = list;

  return (
    <Screen edges={["top"]}>
      {/* ПРАЙС ОДНОЙ КОМАНДЫ, И ПЕРЕКЛЮЧАТЬ ЕГО ЗДЕСЬ НЕЧЕМ (владелец
          2026-08-24: «мне не нравится, что в услугах можно выбирать команда
          один, команда два, команда три… можно ошибиться очень легко»).
          Лента чипов снесена: она предлагала сменить владельца прайса на том
          же экране, где его правят, — и услуга уезжала не в ту команду одним
          промахом пальца. Команда теперь приходит СНАРУЖИ: из адреса
          (Кабинет → Команды → услуги) или из той, что открыта в календаре.
          Имя команды стоит подзаголовком — «какой команде принадлежат
          услуги» видно, но тронуть его отсюда нельзя. */}
      {/* ИКОНКИ АРХИВА В ШАПКЕ БОЛЬШЕ НЕТ. Она вела на отдельный экран
          убранных услуг — он был нужен, пока выключенная услуга исчезала из
          списка совсем. Теперь она остаётся на месте серой, и включают её тем
          же свайпом, каким выключили: дверь во второй экран стала дверью в
          пустую комнату. */}
      <ScreenHeader
        title="Услуги"
        subtitle={activeTeam?.name ?? undefined}
      />

      {servicesQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : servicesQuery.isError ? (
        // Падение справочника КОМАНД экран больше не гасит: команды нужны
        // только для подписи строки и чипов, а прайс читается и без них.
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить услуги"
          subtitle={
            servicesQuery.error instanceof Error
              ? servicesQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void servicesQuery.refetch(),
          }}
        />
      ) : services.length === 0 ? (
        // ПУСТО — КАК ВЕЗДЕ: «услуг пока нет», как в метках.
        //
        // Имени команды в фразе нет: ответ на «чей прайс пустой» уже стоит в
        // шапке подзаголовком. Подписи под заголовком тоже нет: пустое
        // состояние говорит ровно одно — чего здесь нет.
        <EmptyState fill icon={<Briefcase color={t.accent} size={28} />} title="Услуг пока нет" />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          scrollEnabled={!dragging}
        >
          {/* КАЖДАЯ УСЛУГА — СВОЯ СТРОКА, А НЕ ПОЛОСА В ОБЩЕЙ КАРТОЧКЕ
              (владелец 2026-08-22: «разделение не волосины между услугами…
              сделай именно чтобы услуги было каждая своя строка, на хера ты
              вот это вот всё в одну группировку»). Общая карточка склеивала
              прайс в одно полотно, а волосяной шов между строками при свайпе и
              перетаскивании давал те самые перепады: у одной строки фон уезжал,
              у соседней оставался, и линия висела между ними ничьей. Теперь
              строка сама себе поверхность — свой радиус, свой фон, свой зазор,
              — и разделять их нечем, потому что они и так раздельные. */}
          <View style={{ marginHorizontal: GUTTER, marginTop: 8 }}>
            <ReorderList
              items={services}
              rowHeight={ROW_H}
              spaced
              handleInside
              labelFor={(s) => s.name}
              // ПЕРЕТАСКИВАНИЕ РАЗРЕШЕНО: шесть точек справа, услуги меняются
              // местами.
              //
              // Оно возможно, потому что список не фильтруется по
              // `is_active`: скрытые лежат тут же серыми, на экране весь прайс
              // команды целиком, и позиции пишутся полному набору. Иначе
              // запись позиций 0..n только видимым перемешала бы невидимых.
              rangeFor={(index) => (readOnly ? [index, index] : [0, services.length - 1])}
              onReorder={(ids) => reorder.mutate(ids, { onError: alertError })}
              onDraggingChange={setDragging}
            >
              {(svc, _index, handle) => <ServicePriceRow svc={svc} handle={handle} list={list} />}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* НИЖНЯЯ КНОПКА — общий рецепт продукта: «Финансы» так добавляют
          операцию, «Клиенты» — клиента. Она стоит всегда, а не только на
          пустом экране: заводить услуги приходят пачкой. */}
      {readOnly ? null : (
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        {/* ПРАЙС БЕЗ БРИГАДЫ ВЕДЁТ НЕ В СТЕНУ. Услуга принадлежит ровно одной
            команде, а команд нет у 17 тенантов из 19: человек набирал имя,
            цену и минуты и упирался в серую кнопку «Создать», которая не
            сработает НИКОГДА и не говорит почему. Теперь кнопка ведёт туда,
            где эта дорога начинается. */}
        {/* ПОКА КОМАНДЫ ГРУЗЯТСЯ — НЕ ВРАТЬ ПРО ИХ ОТСУТСТВИЕ (аудит
            2026-08-21). `teams.length === 0` истинно и в первую секунду
            загрузки справочника, поэтому владельцу с тремя командами экран
            успевал предложить «Создать команду». Ждать ответа справочника
            дешевле, чем показать неправду. */}
        <GradientButton
          label={teamsUnknown || teams.length > 0 ? "Создать услугу" : "Создать команду"}
          disabled={teamsUnknown}
          onPress={() => {
            if (teams.length === 0) {
              router.push("/calendar");
              return;
            }
            // ВСЕГДА С НУЛЯ: лист «Создать с нуля / или взять готовую» был бы
            // лишним экраном между намерением и формой, и вставал бы только
            // когда в других командах что-то есть — кнопка вела бы себя
            // по-разному в разные дни. Копирование готовой есть в шаблонах
            // листа услуги.
            setEditing({ mode: "create" });
          }}
        />
      </View>
      )}

      <ServiceSheet
        editing={editing}
        lockedTeamId={activeTeamId ?? undefined}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        templates={readOnly ? undefined : templates}
      />


    </Screen>
  );
}
