import { Stack } from "expo-router";
import { MessagingFeatureBoundary } from "@/features/chats/MessagingFeatureBoundary";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

export default function ChatsLayout() {
  return (
    <MessagingFeatureBoundary>
      <RoleCapabilityBoundary capability="manage-messaging" title="Чаты">
        <Stack screenOptions={{ headerShown: false }} />
      </RoleCapabilityBoundary>
    </MessagingFeatureBoundary>
  );
}
