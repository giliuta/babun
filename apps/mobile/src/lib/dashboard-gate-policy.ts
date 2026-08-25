import type { OnboardingGate } from "@/lib/tenant";

/** Unknown + no tenant cannot safely mount tenant-scoped role boundaries. */
export function shouldBlockUnresolvedTenant(gate: OnboardingGate): boolean {
  return gate.status === "unknown" && gate.tenantId === null;
}
