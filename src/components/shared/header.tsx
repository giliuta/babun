import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/shared/user-menu";
import { GlobalSearch } from "@/components/shared/global-search";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationCenter } from "@/components/shared/notification-center";
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
    <header className="flex h-14 items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
      <MobileSidebar />
      <span className="hidden text-sm font-semibold sm:block">
        {tenantName}
      </span>
      <div className="hidden md:block">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <NotificationCenter />
        <UserMenu
          fullName={profile?.full_name ?? userEmail ?? "User"}
          email={userEmail}
          role={profile?.role ?? ""}
        />
      </div>
    </header>
  );
}
