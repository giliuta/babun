import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { NameColorField } from "@/components/ui/picker-fields";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  useCreateTeam,
  type Team,
} from "@/features/reference/queries";
import { useCreateTeamAccounts } from "@/features/finances/accounts";

// СОЗДАНИЕ КАЛЕНДАРЯ — ЕДИНСТВЕННАЯ ДВЕРЬ НА ВЕСЬ ПРОДУКТ.
//
// Владелец 2026-08-27: «кнопочка создать календарь должна быть именно в
// настройках календаря, а там где оно прежде находится — удалить оттуда».
// Раньше календарь заводился в Кабинет → Команды, то есть под другим именем
// и в другой вкладке; владелец искал его в настройках календаря и не нашёл.
//
// ДВА ВОПРОСА И НИ ОДНОГО ЛИШНЕГО. Имя и цвет — всё, без чего календаря не
// существует: имя стоит в чипе над сеткой, цвет красит его записи. Остальное
// (часы, график, услуги, метки) правится на самом экране настроек, куда
// человек и попадает сразу после создания.
//
// ПОЛЯ «РЕГИОН» ЗДЕСЬ НЕТ. В старой форме оно было, и удалили его по решению
// владельца 2026-08-27 («регион по сути на хуй не нужен»): колонка
// заполнена у 2 команд из 7, читалась подписью в двух списках и не влияла
// ни на одну строку логики.
//
// СЧЕТА ЗАВОДЯТСЯ САМИ (ТЗ §5.1). Календарь без счёта не может принять
// деньги — это поломка, а не выбор. «Наличные» и «Карта» создаются молча, а
// тост говорит, что появилось, и даёт дверь, если имена не подошли.
export function CalendarCreateSheet({
  visible,
  onClose,
  onCreated,
  teams,
}: {
  visible: boolean;
  onClose: () => void;
  /** Родитель переключает ленту на новый календарь и запоминает выбор. */
  onCreated: (team: Team) => void;
  /** Уже существующие — из них берётся ещё не занятый цвет. */
  teams: Team[];
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const create = useCreateTeam();
  const seedAccounts = useCreateTeamAccounts();

  // Первый свободный цвет рабочей палитры — чтобы чипы календарей
  // оставались различимы, а первый календарь не рождался вишнёвым.
  const nextColor = useMemo(() => {
    const used = new Set(teams.map((x) => x.color).filter(Boolean));
    return (
      PRESET_COLOR_CYCLE.find((c) => !used.has(c.value))?.value ??
      PRESET_COLOR_CYCLE[0].value
    );
  }, [teams]);

  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(nextColor);
  const [failure, setFailure] = useState<string | null>(null);

  // Лист всегда в дереве и лишь гасится пропом `visible` (канон §5), поэтому
  // черновик надо сбрасывать явно — иначе имя прошлого календаря встретит
  // человека при следующем открытии.
  useEffect(() => {
    if (visible) {
      setName("");
      setColor(nextColor);
      setFailure(null);
    }
  }, [visible, nextColor]);

  // Кнопка гаснет по двум причинам, но ОБЪЯСНЯЕТСЯ только одна.
  //
  // «Нет связи» назвать обязательно: причина снаружи продукта, и без слов
  // серая кнопка читается как поломка. А вот «дайте календарю название»
  // владелец 2026-08-27 убрал — «это просто лишнее», и он прав: поле стоит
  // ПРЯМО НАД кнопкой, оно пустое и в фокусе, курсор в нём мигает. Подпись
  // повторяла словами то, что и так видно, и висела всё время, пока человек
  // не начал печатать, — то есть с первой секунды открытия листа.
  const offline = !online;
  const canSave = !offline && name.trim().length > 0 && !create.isPending;
  const footerNote =
    failure ??
    (create.isPending || !offline ? null : "Нет связи — календарь не создать");

  const submit = async () => {
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть.
    if (!isOnline()) {
      setFailure("Нет связи — календарь не создать");
      return;
    }
    setFailure(null);
    let team: Team;
    try {
      team = await create.mutateAsync({ name: name.trim(), color: color ?? undefined });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Не удалось создать календарь");
      return;
    }
    // Календарь уже есть — закрываем лист и переключаем ленту ДО засева
    // счетов: счета это следствие, и ждать их, глядя на форму, незачем.
    onCreated(team);
    onClose();
    try {
      const created = await seedAccounts.mutateAsync(team.id);
      if (created.length > 0) {
        toast(
          `Календарю «${team.name}» созданы счета: ${created.map((a) => a.name).join(", ")}`,
          "success",
          // «Изменить» ведёт на счета ИМЕННО ЭТОГО календаря: без параметра
          // экран открывался на первом чипе, и человек смотрел на чужие
          // счета сразу после слов «созданы счета».
          { label: "Изменить", onPress: () => router.push(`/accounts?team=${team.id}`) },
        );
      }
    } catch (e) {
      // Календарь создан — молчать нельзя, но и держать человека незачем:
      // счета дозаводятся из настроек счетов.
      toast(
        `Календарь создан, но счета не завелись: ${
          e instanceof Error ? e.message : "попробуйте ещё раз"
        }`,
        "error",
      );
    }
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Новый календарь"
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          {footerNote ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mb-2 text-center text-[13px]"
              style={{ color: failure ? t.danger : t.sub }}
            >
              {footerNote}
            </Text>
          ) : null}
          <GradientButton
            label="Создать календарь"
            onPress={submit}
            disabled={!canSave}
            loading={create.isPending}
          />
        </View>
      }
    >
      {/* ТА ЖЕ СТРОКА, ЧТО И В НАСТРОЙКАХ КАЛЕНДАРЯ (владелец 2026-08-27:
          «название и так далее сделаем то же самое, как в основном
          календаре: слева цвет, справа название»). Раньше здесь стояли поле
          «Название» и отдельная строка «Цвет» — два элемента там, где в
          настройках один, и созданный календарь выглядел иначе, чем тот же
          календарь минутой позже.

          ПОДСКАЗКИ «Бригада 2» БОЛЬШЕ НЕТ. Она предлагала назвать календарь
          бригадой — словом из другой части продукта, — и на пустом поле
          читалась как уже введённое имя. */}
      <View style={{ paddingBottom: 8 }}>
        <SectionCard>
          <NameColorField
            bare
            label={null}
            name={name}
            onNameChange={(v) => {
              setName(v);
              setFailure(null);
            }}
            color={color}
            onColorChange={(hex) => setColor(hex)}
            autoFocus
          />
        </SectionCard>
      </View>
    </BottomSheet>
  );
}
