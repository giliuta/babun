import { DashboardShell } from "@/components/shared/dashboard-shell";
import { Header } from "@/components/shared/header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell>
      <Header />
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </DashboardShell>
  );
}
