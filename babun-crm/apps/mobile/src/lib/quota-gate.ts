import { createQuotaGate } from "@/lib/quota";
import { supabase } from "@/lib/supabase";

/** Canonical mobile replay gate. Kept in this tiny runtime adapter so the
 * pure quota policy remains unit-testable without loading React Native's
 * secure-storage implementation in Bun. */
export const quotaGate = createQuotaGate(supabase);
