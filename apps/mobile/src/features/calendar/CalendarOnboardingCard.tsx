import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Check, ChevronRight, X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { ICON } from "@/components/ui/tokens";
import { useCurrentRole } from "@/features/settings/tenant";
import { TariffLocked } from "@/features/tariffs/TariffLocked";

// Онбординг первого запуска — web CalendarOnboardingCard (STORY-060 §F1.1).
// Плавает над пустой сеткой, пока у тенанта нет записей.
//
// Три правки против прежней версии, каждая — по факту поведения:
//  1. Гейт по записям, а не по «0 клиентов И 0 услуг И 0 записей»: заведя
//     одного клиента, человек терял карточку вместе с невыполненным шагом
//     «заведите услугу». Пройденные шаги теперь помечаются галочкой — список
//     остаётся, пока не станет настоящим.
//  2. top:80 вместо центра: карточка садилась ровно на середину сетки и
//     глотала тапы по тем самым слотам, по которым сама же просила тапнуть.
//  3. Шаг 3 — кнопка, а не текст «Тапните по свободному слоту»: приложение
//     не учит жестам, оно даёт нажать.
//
// БЕЗ ТАРИФА ШАГИ ВЕДУТ НЕ В ТУПИК (аудит первого входа 03.10). Новый аккаунт
// живёт на бесплатном плане: клиент открывался запертой карточкой без слова
// почему, услуга падала отказом сервера, третий шаг не загорался никогда.
// Теперь клиент и услуга — серым с плашкой «Нужно изменить тариф» (как всё
// закрытое тарифом), а третий шаг — событие: его план разрешает.
export function CalendarOnboardingCard({
  hasClients,
  hasServices,
  workInPlan,
  servicesHref,
  onCreate,
  onDismiss,
}: {
  hasClients: boolean;
  hasServices: boolean;
  /** Тариф разрешает работу с клиентами (`usePlanAllows("book-clients")`). */
  workInPlan: boolean;
  /** Услуги ЭТОЙ команды в шестерёнке календаря — не уводит во вкладку
   *  «Кабинет» посреди календаря. */
  servicesHref: string;
  /** Создать первую запись — активна, когда есть клиент и услуга; без
   *  тарифа — первое событие, сразу. */
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: role } = useCurrentRole();

  const steps: {
    n: number;
    label: string;
    done?: boolean;
    disabled?: boolean;
    locked?: boolean;
    onPress?: () => void;
  }[] = [
    {
      n: 1,
      label: "Добавьте клиента",
      done: hasClients,
      locked: !workInPlan,
      onPress: () => router.push("/clients/new"),
    },
    {
      n: 2,
      label:
        role === "dispatcher" && !hasServices
          ? "Попросите владельца добавить услугу"
          : "Заведите услугу",
      done: hasServices,
      locked: !workInPlan,
      onPress:
        role === "owner" ? () => router.push(servicesHref as Href) : undefined,
    },
    {
      n: 3,
      label: workInPlan ? "Запланируйте запись" : "Запланируйте событие",
      disabled: workInPlan && (!hasClients || !hasServices),
      onPress: onCreate,
    },
  ];

  return (
    // box-none: карточка ловит тапы только собой — сетка, шапка и таб-бар
    // вокруг остаются живыми.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 80,
        left: 0,
        right: 0,
        alignItems: "center",
        paddingHorizontal: 16,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: t.surface,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.separator,
          padding: 20,
          boxShadow: t.cardShadow,
        }}
      >
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Скрыть подсказку"
          className="active:opacity-60"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            height: 28,
            width: 28,
            borderRadius: t.radius.card,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          <X color={t.faint} size={ICON.xs} strokeWidth={2.2} />
        </Pressable>

        <Text
          // paddingRight: длинный заголовок не налезает на кнопку ✕.
          style={{
            fontSize: 17,
            fontWeight: "600",
            color: t.ink,
            marginBottom: 14,
            paddingRight: 28,
          }}
        >
          Начните за 3 шага
        </Text>

        <View style={{ gap: 8 }}>
          {steps.map(({ locked, ...s }) => (
            <TariffLocked key={s.n} locked={!!locked && !s.done}>
              <StepRow {...s} />
            </TariffLocked>
          ))}
        </View>
      </View>
    </View>
  );
}

function StepRow({
  n,
  label,
  done,
  disabled,
  onPress,
}: {
  n: number;
  label: string;
  done?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const rowStyle = {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: t.radius.input,
    backgroundColor: t.fill,
    opacity: disabled ? 0.5 : 1,
  } as const;
  const body = (
    <>
      <View
        style={{
          height: 28,
          width: 28,
          borderRadius: t.radius.card,
          backgroundColor: done ? `${t.success}1f` : `${t.accent}1f`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? (
          <Check color={t.success} size={16} strokeWidth={2.6} />
        ) : (
          <Text
            style={{ fontVariant: ["tabular-nums"], fontSize: 14, fontWeight: "700", color: t.accent }}
          >
            {n}
          </Text>
        )}
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: "600",
          color: done ? t.faint : t.ink,
          textDecorationLine: done ? "line-through" : "none",
        }}
      >
        {label}
      </Text>
      {onPress && !done ? <ChevronRight color={t.chevron} size={ICON.sm} /> : null}
    </>
  );
  return onPress && !done ? (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      className="active:opacity-60"
      style={rowStyle}
    >
      {body}
    </Pressable>
  ) : (
    // «Сделано» несут только зелёная галочка и зачёркивание — для VoiceOver
    // это невидимо, и пройденный шаг звучал бы неотличимо от невыполненного.
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={done ? `${label} — сделано` : label}
      style={rowStyle}
    >
      {body}
    </View>
  );
}
