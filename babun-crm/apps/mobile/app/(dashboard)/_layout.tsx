import { Redirect, Tabs } from "expo-router";
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
import { useSession } from "@/providers/SessionProvider";
import { useOnboardingGate } from "@/lib/tenant";

export default function DashboardLayout() {
  const t = useThemeColors();
  const { session } = useSession();
  // Onboarding gate — web parity with apps/web/src/app/dashboard/layout.tsx
  // (STORY-040). Fail-open: "unknown" (a transient lookup error) stays in the
  // dashboard so a configured user is never bounced onto the wizard.
  const gate = useOnboardingGate();
  // Unread badge on the «Чаты» tab icon (web parity: the unread chip in
  // the chats nav title, chats/page.tsx:256–260). Reads the same ["chats"]
  // query the screens mutate, so it updates live.
  const { data: chats = [] } = useChats();
  const unread = getTotalUnread(chats);

  // Route guard rendered as <Redirect> (not an effect): a signed-out user is
  // sent to /login before the calendar can ever paint — no startup flash. The
  // root layout has already resolved the session, so `session` here is final.
  if (!session) return <Redirect href="/login" />;
  if (gate.status === "loading") return null;
  if (gate.status === "needs-onboarding" || gate.status === "no-tenant") {
    return <Redirect href="/onboarding" />;
  }

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
