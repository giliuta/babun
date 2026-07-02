import { Tabs } from "expo-router";
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

export default function DashboardLayout() {
  const t = useThemeColors();
  // Unread badge on the «Чаты» tab icon (web parity: the unread chip in
  // the chats nav title, chats/page.tsx:256–260). Reads the same ["chats"]
  // query the screens mutate, so it updates live.
  const { data: chats = [] } = useChats();
  const unread = getTotalUnread(chats);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.faint,
        sceneStyle: { backgroundColor: t.canvas },
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.separator,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Календарь",
          tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Клиенты",
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Чаты",
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
          ),
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: t.danger,
            color: "#fff",
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      />
      <Tabs.Screen
        name="finances"
        options={{
          title: "Финансы",
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cabinet"
        options={{
          title: "Кабинет",
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
