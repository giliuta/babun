import { View } from "react-native";
import { TemplateList, TemplatesHeaderButton } from "@/components/ui/TemplatePicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { RowCaption } from "@/components/ui/card-rows";
import { FOOTER_SIDE } from "@/components/ui/tokens";
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
// Канонический нижний лист, а не самописный `Modal animationType="slide"`:
// самописная «серая плашка, которая поднимается вверх» не годится.
export function ServiceSheet(props: ServiceSheetProps) {
  const { editing, busy, templates } = props;
  const sheet = useServiceSheet(props);
  const { service, guard, picking, setPicking, scrollRef, canPickTemplate, submit, canSubmit, currencySymbol } = sheet;

  return (
    <BottomSheet
      visible={editing !== null && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      // ЗАГОЛОВОК НАЗЫВАЕТ УСЛУГУ, А НЕ ЖАНР. «Услуга» — это то, что человек и
      // так видит: он тапнул по строке прайса. Имя в шапке отвечает на другой
      // вопрос — «ту ли я открыл», — который в списке из сорока строк задают
      // всерьёз.
      title={service ? service.name : "Новая услуга"}
      scroll
      scrollRef={scrollRef}
      avoidKeyboard
      padded={false}
      // ЗНАЧКОВ В ШАПКЕ НЕТ. «Удалить» и «скрыть» живут на кромках свайпа, у
      // каждой своя сторона и своё подтверждение; мусорка в шапке вдобавок
      // обрезалась бы правым краем листа. «Дублировать» тоже нет: скопировать
      // услугу можно, заведя новую.
      headerAction={
        canPickTemplate ? (
          <TemplatesHeaderButton picking={picking} onToggle={() => setPicking((v) => !v)} />
        ) : undefined
      }
      footer={
        picking ? undefined : (
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
        <Button
          label={service ? "Сохранить" : "Создать услугу"}
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

      {/* ЧЕТЫРЕ БЛОКА: количество, цена, расход, время. Всего, что ниже
          названия, больше нет.

          ЧТО ИЗ ИНТЕРФЕЙСА УБРАНО: «Тип услуги» и ветка «Варианты» (плоский
          список именованных опций), «Проверка» (живой калькулятор «что
          получится на N штуках»), «Время вокруг работы» (дорога, после,
          людей), «Ограничения» (минимум, максимум).

          ПОЛЯ БАЗЫ НЕ ТРОНУТЫ. Состояние живо, `submit` пишет те же колонки
          прежними значениями, уже заведённые услуги ничего не теряют при
          сохранении. Убран ТОЛЬКО интерфейс — вернуть его можно, не трогая
          данные. */}
      <ServiceSheetLadder sheet={sheet} />

      <ServiceWeekdaysBlock sheet={sheet} />

      <ServiceBufferBlock sheet={sheet} />

      {/* «ОНЛАЙН-ЗАПИСЬ · СКОРО» СНЯТА (выпуск в магазины): заглушка
          «скоро» в форме читается проверкой App Store как недоделанная
          функция. Колонка `online_enabled` в базе остаётся — строка вернётся
          настоящим переключателем вместе с самой функцией. */}

      {/* ПОД ТАБЛИЦЕЙ — ТОЛЬКО ОШИБКА. Тихая строка-проверка «а что будет на
          семи» отвечала бы на вопрос, которого человек не задавал, и висела бы
          под карточкой ещё одной серой строкой. Ответ и так виден: за
          последней заведённой строкой цена и время идут по её правилу. */}
      {sheet.firstError ? <RowCaption text={sheet.firstError} tone="danger" /> : null}

      {/* Воздух под последним блоком: без него «＋ Добавить» прижимается к
          кнопке футера и читается как её часть. */}
      <View style={{ height: 12 }} />

      </>
      )}
    </BottomSheet>
  );
}
