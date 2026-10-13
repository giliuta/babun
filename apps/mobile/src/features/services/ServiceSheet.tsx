import { View } from "react-native";
import { TemplateList, TemplatesHeaderButton } from "@/components/ui/TemplatePicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { RowCaption } from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import { type Service } from "@/features/services/queries";
import { ServiceBufferBlock } from "./service-sheet/ServiceBufferBlock";
import { ServiceNameBlock } from "./service-sheet/ServiceNameBlock";
import { ServiceSheetLadder } from "./service-sheet/ServiceSheetLadder";
import { ServiceWeekdaysBlock } from "./service-sheet/ServiceWeekdaysBlock";
import { useServiceSheet, type ServiceSheetProps } from "./service-sheet/use-service-sheet";

// ФОРМА УСЛУГИ ПРАЙСА — своим файлом, а не внутри страницы (страница была
// 1457 строк). Вид и поведение — те же, что были на странице. Части формы —
// в `service-sheet/`.

export type ServiceEditing =
  // `copy` — источник из ДРУГОЙ команды: имя не получает «копия» (в новой
  // команде это не копия, а своя услуга) и пишется связь для отчётов.
  | { mode: "create"; from?: Service; copy?: boolean }
  | { mode: "edit"; service: Service };

// ─── Редактор услуги ─────────────────────────────────────────────────
// Канонический нижний лист, а не самописный `Modal animationType="slide"`: та
// самая «серая плашка, которая поднимается вверх», забракованная владельцем на
// метках 2026-08-17.
export function ServiceSheet(props: ServiceSheetProps) {
  const { editing, busy, templates } = props;
  const sheet = useServiceSheet(props);
  const { service, guard, picking, setPicking, scrollRef, canPickTemplate, submit, canSubmit, currencySymbol } = sheet;

  return (
    <BottomSheet
      visible={editing !== null && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      // ЗАГОЛОВОК НАЗЫВАЕТ УСЛУГУ, А НЕ ЖАНР (аудит 2026-08-21). «Услуга» —
      // это то, что человек и так видит: он тапнул по строке прайса. Имя в
      // шапке отвечает на другой вопрос — «ту ли я открыл», — который в списке
      // из сорока строк задают всерьёз.
      title={service ? service.name : "Новая услуга"}
      scroll
      scrollRef={scrollRef}
      avoidKeyboard
      padded={false}
      // ЗНАЧКОВ В ШАПКЕ НЕТ (владелец 2026-08-29: «убери эти кнопочки, они
      // нам на хер не нужны — у нас свайп вправо и можно удалить»).
      //
      // Здесь стояли «дублировать» и «удалить». Обе двери стали лишними:
      // удаление и скрытие теперь живут на кромках свайпа, у каждой своя
      // сторона и своё подтверждение. А мусорка вдобавок ОБРЕЗАЛАСЬ правым
      // краем листа — красный значок наполовину уходил за экран.
      //
      // Дубль исчез вместе с ней: он был обходом того, что свайп вправо
      // когда-то съедал системный жест «назад». Сейчас вправо — «Удалить»,
      // и обходить нечего; скопировать услугу можно, заведя новую.
      headerAction={
        canPickTemplate ? (
          <TemplatesHeaderButton picking={picking} onToggle={() => setPicking((v) => !v)} />
        ) : undefined
      }
      footer={
        picking ? undefined : (
        <View style={{ paddingHorizontal: GUTTER }}>
        <Button
          label={service ? "Сохранить" : "Создать"}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
        />
        </View>
        )
      }
    >
      {picking ? (
        <TemplateList
          items={(templates ?? []).map(({ service: sv, teamName }) => ({
            key: sv.id,
            name: sv.name,
            color: sv.color ?? null,
            icon: sv.icon ?? null,
            sub: teamName,
            trailing: `${currencySymbol}${Number(sv.price)}`,
            value: sv,
          }))}
          onPick={sheet.applyTemplate}
        />
      ) : (
      <>
      <ServiceNameBlock sheet={sheet} />

      {/* ЧЕТЫРЕ БЛОКА ВМЕСТО ВСЕГО, ЧТО ЗДЕСЬ БЫЛО (владелец 2026-08-27:
          «всё, что ниже названия, удаляем; первый блок — количество, второй —
          цена, третий — расход, четвёртый — время»).

          ЧТО УБРАНО ИЗ ИНТЕРФЕЙСА:
            • «Тип услуги» и ветка «Варианты» — плоский список именованных
              опций;
            • «Проверка» — живой калькулятор «что получится на N штуках»;
            • «Время вокруг работы» (дорога, после, людей) и «Ограничения»
              (минимум, максимум);
            • «Работаем по дням» — семь плиток.

          НИ ОДНО ПОЛЕ БАЗЫ НЕ ТРОНУТО. Состояние живо, `submit` пишет те же
          колонки прежними значениями, уже заведённые услуги ничего не теряют
          при сохранении. Убран ТОЛЬКО интерфейс — вернуть его можно, не
          трогая данные. */}
      <ServiceSheetLadder sheet={sheet} />

      <ServiceWeekdaysBlock sheet={sheet} />

      <ServiceBufferBlock sheet={sheet} />

      {/* «ОНЛАЙН-ЗАПИСЬ · СКОРО» СНЯТА (06.10, выпуск в магазины): заглушка
          «скоро» в форме читается проверкой App Store как недоделанная
          функция. Колонка `online_enabled` в базе остаётся — строка вернётся
          настоящим переключателем вместе с самой функцией. */}

      {/* ПОД ТАБЛИЦЕЙ — ТОЛЬКО ОШИБКА (владелец 2026-08-21: «внизу не нужно
          писать, это полная хуета»). Тихая строка-проверка «а что будет на
          семи» отвечала на вопрос, которого человек не задавал, и висела под
          карточкой ещё одной серой строкой. Ответ и так виден: за последней
          заведённой строкой цена и время идут по её правилу. */}
      {sheet.firstError ? <RowCaption text={sheet.firstError} tone="danger" /> : null}

      {/* Воздух под последним блоком: без него «＋ Добавить» прижимается к
          кнопке футера и читается как её часть. */}
      <View style={{ height: 12 }} />

      </>
      )}
    </BottomSheet>
  );
}
