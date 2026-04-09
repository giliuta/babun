import { DashboardShell } from "@/components/shared/dashboard-shell";
import { Header } from "@/components/shared/header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { KeyboardShortcuts } from "@/components/shared/keyboard-shortcuts";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell>
      <KeyboardShortcuts />
      <Header />
      <div className="flex-1 overflow-auto">
        <div className="px-6 pt-4">
          <Breadcrumbs />
        </div>
        <div className="p-6 pt-3">{children}</div>
      </div>
    </DashboardShell>
  );
}
