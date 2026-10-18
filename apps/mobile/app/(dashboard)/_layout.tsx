import { View } from "react-native";
import { Tabs } from "expo-router";
import { StackActions } from "@react-navigation/native";
import {
  Calendar,
  LayoutGrid,
  MessageCircle,
  Users,
  Wallet,
} from "lucide-react-native";
import { getTotalUnread } from "@babun/shared/local/chats";
import { useThemeColors } from "@/theme/colors";
import { useChats } from "@/features/chats/store";
import { useMyInvitations } from "@/features/access/inbox-queries";
import { useCurrentRole } from "@/session/tenant";
import { MESSAGING_ENABLED, can } from "@/session/role-policy";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { DashboardGate } from "@/lib/DashboardGate";
import { TeamActivityNotifier } from "@/features/cabinet/TeamActivityNotifier";
import { TourWindow } from "@/components/tour/TourWindow";
import { OnboardingRunner } from "@/features/onboarding/OnboardingRunner";
import { useTabLocks } from "@/features/onboarding/tab-locks";

export default function DashboardLayout() {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const canMessages = can(role, "manage-messaging");
  // ВКЛАДКИ НЕ ЗАВИСЯТ ОТ ПРАВА.
  //
  // Команда — это только база данных и разрешения на неё: при переходе на
  // другую команду экран тот же, меняется только база. Если прятать
  // Клиентов и Финансы через `href: null`, когда роль не даёт права, то при
  // переходе в команду, где человек лишь смотрит, четыре вкладки станут
  // двумя, и экран «поменяется».
  //
  // Поэтому ряд вкладок ОДИН на все команды. Право проверяет граница внутри
  // каждой вкладки (`clients/_layout`, `finances/_layout`, `chats/_layout`):
  // без права она показывает «появятся, когда владелец откроет доступ» — это
  // ровно тот «блок виден только для чтения», который допускает правило 10
  // канона, а не «видно, но при нажатии ошибка».
  //
  // Заодно уходит мелькание: пока роль летела с сервера, `can()` отвечал
  // «нет», и вкладки появлялись через секунду после экрана.
  //
  // Чаты — исключение НЕ по праву, а по готовности продукта: пока
  // `MESSAGING_ENABLED` выключен, вкладки нет ни у кого.
  // Unread badge on the «Чаты» tab icon (web parity: the unread chip in
  // the chats nav title, chats/page.tsx:256–260). Reads the same ["chats"]
  // query the screens mutate, so it updates live.
  // Do not even hydrate the device-local inbox for a master account. The
  // hidden tab is a navigation affordance; this query gate is the data guard.
  const { data: chats = [] } = useChats(canMessages);
  const unread = getTotalUnread(chats);
  // ПРИГЛАШЕНИЯ ЖДУТ ОТВЕТА — КРАСНЫЙ СЧЁТЧИК НА «КАБИНЕТЕ». Вид тот же, что у
  // счётчика «Чатов», — второй анатомии значка в продукте не заводим.
  const { data: invitations = [] } = useMyInvitations();
  const invitationCount = invitations.length;

  // Бледные вкладки до первого календаря и до пройденных глав обучения —
  // `features/onboarding/tab-locks.tsx`.
  const locks = useTabLocks(invitationCount);

  // Гварды сессии/тенанта живут в DashboardGate — тем же компонентом их
  // переиспользует стек /calendar, который лежит НАД табами.
  return (
    <DashboardGate>
      {/* Уведомления о делах команды из истории изменений — пока
          приложение открыто; без интерфейса. */}
      <TeamActivityNotifier />
      <OnboardingRunner />
      {/* ОКНО ОБУЧЕНИЯ — НАД ТАБ-БАРОМ: пока идёт шаг, нажать можно только
          подсвеченное, и вкладки тоже закрыты. */}
      <View style={{ flex: 1 }}>
      <TourWindow id="root">
      <RoleCapabilityBoundary capability="view-cabinet" title="Babun">
        <Tabs
          // ПОВТОРНЫЙ ТАП ПО СВОЕЙ ЖЕ ВКЛАДКЕ ВОЗВРАЩАЕТ К ЕЁ НАЧАЛУ.
          // Переключение вкладок память стека НЕ трогает (поведение табов
          // из коробки): возврат на вкладку открывает ту же страницу, где
          // были. Здесь добавлен только второй тап по текущей вкладке:
          // он разматывает стек вкладки до корня. Иначе из настроек можно
          // выйти лишь стрелкой «назад» столько раз, сколько провалился.
          screenListeners={({ navigation, route }) => ({
            tabPress: () => {
              if (!navigation.isFocused()) return;
              const tab = navigation
                .getState()
                .routes.find((r) => r.key === route.key);
              // Ключ вложенного стека появляется, только когда вкладку хоть раз
              // открывали; на нетронутой разматывать нечего.
              if (!tab?.state?.key) return;
              if ((tab.state.index ?? 0) === 0) return;
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: tab.state.key,
              });
            },
          })}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: t.accent,
            tabBarInactiveTintColor: t.faint,
            tabBarAllowFontScaling: false,
            sceneStyle: { backgroundColor: t.canvas },
            tabBarStyle: {
              backgroundColor: t.surface,
              borderTopColor: t.separator,
            },
            tabBarLabelStyle: { fontSize: 10, fontWeight: "500" },
            // СКРЫТАЯ ВКЛАДКА СПИТ. Однажды открытые
            // «Клиенты» и «Финансы» оставались подписаны на записи и на
            // каждое их изменение — перетаскивание блока, сохранение формы,
            // возврат приложения — пересчитывали в фоне статистику клиентов,
            // фильтры и десятки сумм, ровно когда календарь анимирует.
            // Заснувшая вкладка догоняет данные в миг возврата. Календарь не
            // усыпляется: он ведёт напоминания (`reconcile…`) для всего
            // приложения.
            freezeOnBlur: true,
          }}
        >
        {/* Активная вкладка выделяется весом штриха (2.4 vs 2), не второй
            заливкой — у lucide нет filled-вариантов, а цвета уже хватает. */}
        <Tabs.Screen
          name="(home)"
          options={{
            freezeOnBlur: false,
            title: "Календарь",
            tabBarIcon: ({ color, size, focused }) => (
              <Calendar color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
          }}
        />
        <Tabs.Screen
          name="clients"
          listeners={locks.listeners("clients")}
          options={{
            title: "Клиенты",
            ...locks.options("clients"),
            tabBarIcon: locks.icon("clients", Users),
          }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: "Чаты",
            href: MESSAGING_ENABLED ? "/chats" : null,
            tabBarIcon: ({ color, size, focused }) => (
              <MessageCircle color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
            tabBarBadge: unread > 0 ? (unread > 99 ? "99" : unread) : undefined,
            tabBarBadgeStyle: {
              backgroundColor: t.danger,
              color: t.onAccent,
              fontSize: 11,
              fontWeight: "600",
            },
          }}
        />
        <Tabs.Screen
          name="finances"
          listeners={locks.listeners("finances")}
          options={{
            title: "Финансы",
            ...locks.options("finances"),
            tabBarIcon: locks.icon("finances", Wallet),
          }}
        />
        <Tabs.Screen
          name="cabinet"
          listeners={locks.listeners("cabinet")}
          options={{
            title: "Кабинет",
            ...locks.options("cabinet"),
            tabBarBadge: invitationCount > 0 ? invitationCount : undefined,
            tabBarBadgeStyle: {
              backgroundColor: t.danger,
              color: t.onAccent,
              fontSize: 11,
              fontWeight: "600",
            },
            tabBarIcon: locks.icon("cabinet", LayoutGrid),
          }}
        />
        </Tabs>
      </RoleCapabilityBoundary>
      </TourWindow>
      </View>
    </DashboardGate>
  );
}
