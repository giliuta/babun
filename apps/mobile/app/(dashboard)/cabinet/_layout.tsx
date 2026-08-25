import { Stack } from "expo-router";
import { CabinetRoleBoundary } from "@/features/settings/CabinetRoleBoundary";

export default function CabinetLayout() {
  return (
    <CabinetRoleBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </CabinetRoleBoundary>
  );
}
