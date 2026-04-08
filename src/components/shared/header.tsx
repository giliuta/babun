import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/shared/user-menu";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSidebar } from "@/components/shared/mobile-sidebar";

export async function Header() {
  let profile: {
    full_name: string;
    email: string | null;
    role: string;
  } | null = null;
  let tenantName = "Babun CRM";
  let userEmail = "";

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      userEmail = user.email ?? "";
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, email, role, tenant_id")
        .eq("id", user.id)
        .single();

      if (profileData) {
        profile = profileData;
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", profileData.tenant_id)
          .single();
        if (tenant) tenantName = tenant.name;
      }
    }
  } catch {
    // Supabase not configured or auth failed
  }

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
      <MobileSidebar />
      <span className="text-sm font-medium text-muted-foreground">
        {tenantName}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Bell className="h-4 w-4" />
        </Button>
        <UserMenu
          fullName={profile?.full_name ?? userEmail ?? "User"}
          email={userEmail}
          role={profile?.role ?? ""}
        />
      </div>
    </header>
  );
}
