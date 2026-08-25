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
import { useCurrentRole } from "@/features/settings/tenant";
import { can } from "@/features/settings/role-policy";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { DashboardGate } from "@/lib/DashboardGate";

export default function DashboardLayout() {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const canClients = can(role, "operate-clients");
  const canMessages = can(role, "manage-messaging");
  const canFinances = can(role, "view-finances");
  // Unread badge on the «Чаты» tab icon (web parity: the unread chip in
  // the chats nav title, chats/page.tsx:256–260). Reads the same ["chats"]
  // query the screens mutate, so it updates live.
  // Do not even hydrate the device-local inbox for a master account. The
  // hidden tab is a navigation affordance; this query gate is the data guard.
  const { data: chats = [] } = useChats(canMessages);
  const unread = getTotalUnread(chats);

  // Гварды сессии/тенанта живут в DashboardGate — тем же компонентом их
  // переиспользует стек /calendar, который лежит НАД табами.
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="view-cabinet" title="Babun">
        <Tabs
          // ПОВТОРНЫЙ ТАП ПО СВОЕЙ ЖЕ ВКЛАДКЕ ВОЗВРАЩАЕТ К ЕЁ НАЧАЛУ.
          // Владелец 2026-08-20: «тапаю на финансы — перехожу в финансы, тапаю
          // обратно на календарь — возвращаюсь на ту же страницу, где был; а
          // если я уже на календаре и тапну ещё раз — тогда выхожу в сам
          // календарь». Переключение вкладок память стека НЕ трогает (это
          // поведение табов из коробки) — здесь дописан только второй тап:
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
          }}
        >
        {/* Активная вкладка выделяется весом штриха (2.4 vs 2), не второй
            заливкой — у lucide нет filled-вариантов, а цвета уже хватает. */}
        <Tabs.Screen
          name="(home)"
          options={{
            title: "Календарь",
            tabBarIcon: ({ color, size, focused }) => (
              <Calendar color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
          }}
        />
        <Tabs.Screen
          name="clients"
          options={{
            title: "Клиенты",
            href: canClients ? "/clients" : null,
            tabBarIcon: ({ color, size, focused }) => (
              <Users color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
          }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: "Чаты",
            href: canMessages ? "/chats" : null,
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
          options={{
            title: "Финансы",
            href: canFinances ? "/finances" : null,
            tabBarIcon: ({ color, size, focused }) => (
              <Wallet color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
          }}
        />
        <Tabs.Screen
          name="cabinet"
          options={{
            title: "Кабинет",
            tabBarIcon: ({ color, size, focused }) => (
              <LayoutGrid color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
            ),
          }}
        />
        </Tabs>
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}
