"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shared/sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
      </div>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
