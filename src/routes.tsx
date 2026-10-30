import type { ReactElement } from "react";
import { BoxesIcon, LayoutDashboardIcon, PackageCheckIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react";
import { HomePage } from "@/pages/home";
import { MyItemsPage } from "@/pages/my-items";
import { DashboardPage } from "@/pages/dashboard";
import { AdminPage } from "@/pages/admin";

export interface AppRoute {
  path: string;
  element: ReactElement;
  label?: string;
  icon?: LucideIcon;
}

export const routes: AppRoute[] = [
  { path: "/", element: <HomePage />, label: "Catalog", icon: BoxesIcon },
  { path: "/my-items", element: <MyItemsPage />, label: "My items", icon: PackageCheckIcon },
  { path: "/dashboard", element: <DashboardPage />, label: "Dashboard", icon: LayoutDashboardIcon },
  { path: "/admin", element: <AdminPage />, label: "Admin", icon: ShieldCheckIcon },
];
