import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  BoxesIcon,
  LayoutDashboardIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  PackageCheckIcon,
  ShieldCheckIcon,
  ShieldAlertIcon,
  SunIcon,
  SunMoonIcon,
  UserCircle2Icon,
  LockIcon,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorPanel, OfflineBanner } from "@/components/kit";
import { useSession, useSettings, useSystemThemeSync, useTheme, type ThemeChoice } from "@/lib/app-data";
import { initials } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  admin?: boolean;
}
const NAV: NavItem[] = [
  { to: "/", label: "Catalog", icon: BoxesIcon },
  { to: "/my-items", label: "My items", icon: PackageCheckIcon },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { to: "/admin", label: "Admin", icon: ShieldCheckIcon, admin: true },
];

const THEME_LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };
const THEME_ICON: Record<ThemeChoice, LucideIcon> = { system: SunMoonIcon, light: SunIcon, dark: MoonIcon };
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

function ThemeToggle({ compact }: { compact?: boolean }) {
  const choice = useTheme((s) => s.choice);
  const set = useTheme((s) => s.set);
  const Icon = THEME_ICON[choice];
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => set(NEXT_THEME[choice])}
      className="min-h-11 min-w-11 gap-1.5 text-[#F8F4E9] hover:bg-white/15 hover:text-[#F8F4E9]"
      aria-label={`Theme: ${THEME_LABEL[choice]}. Switch to ${THEME_LABEL[NEXT_THEME[choice]]}`}
    >
      <Icon aria-hidden="true" />
      <span className={cn(compact && "max-[379px]:sr-only")}>{THEME_LABEL[choice]}</span>
    </Button>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const choice = useTheme((s) => s.choice);
  const set = useTheme((s) => s.set);
  const name = session?.me?.name ?? session?.fullName ?? "Signed in";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="min-h-11 gap-2 px-2 text-[#F8F4E9] hover:bg-white/15 hover:text-[#F8F4E9]" aria-label={`User menu for ${name}`}>
          <span className="flex size-8 items-center justify-center rounded-full bg-[#F6DBC0] text-xs font-bold text-[#502D55]" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="hidden max-w-40 truncate md:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate">{name}</span>
          {session?.me?.email && <span className="truncate text-xs font-normal text-muted-foreground">{session.me.email}</span>}
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-normal">
            {session?.role === "IT Admin" ? <ShieldCheckIcon className="size-3.5" aria-hidden="true" /> : <UserCircle2Icon className="size-3.5" aria-hidden="true" />}
            {session?.role ?? "Employee"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => set(v as ThemeChoice)}>
          {(["system", "light", "dark"] as ThemeChoice[]).map((c) => (
            <DropdownMenuRadioItem key={c} value={c} className="min-h-11">
              {THEME_LABEL[c]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, error, refetch, usersQuery } = useSession();
  const settings = useSettings();
  if (usersQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-xl p-6">
        <ErrorPanel error={usersQuery.error} onRetry={() => void usersQuery.refetch()} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl p-6">
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isPending || !session) {
    return (
      <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }
  if (session.blocked) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 p-8 text-center" role="alert">
        <LockIcon className="size-10" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Your access is turned off</h1>
        <p className="text-muted-foreground">Your account is marked inactive in this app. Contact the IT team if you need to borrow equipment.</p>
      </div>
    );
  }
  const admin = session.role === "IT Admin";
  return (
    <>
      {session.noActiveAdmin && (
        <div role="status" className="border-b-2 border-overdue bg-card px-4 py-3 text-sm">
          <div className="mx-auto flex max-w-[80rem] items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              <strong>Setup needed:</strong> no active IT Admin is listed. The SharePoint site owner should add a row to the AppUsers list with Role = IT Admin and Active = Yes.
            </p>
          </div>
        </div>
      )}
      {admin && settings.data && settings.data.warnings.length > 0 && (
        <div role="status" className="border-b border-border bg-card px-4 py-2 text-sm">
          <div className="mx-auto max-w-[80rem]">
            <strong>Settings check:</strong> {settings.data.warnings.join(" ")}
          </div>
        </div>
      )}
      {session.identityAmbiguous && (
        <div role="status" className="border-b border-border bg-card px-4 py-2 text-sm">
          <div className="mx-auto max-w-[80rem]">More than one directory account matches your name. Ask an IT admin to add you to the user list so the app can identify you.</div>
        </div>
      )}
      {children}
    </>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  useSystemThemeSync();
  const { data: session } = useSession();
  const admin = session?.role === "IT Admin";
  const items = NAV.filter((n) => !n.admin || admin);
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main-content" className="sr-only z-[60] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="brand-band pt-safe sticky top-0 z-40 text-[#F8F4E9] shadow-sm">
        <div className="px-safe mx-auto flex w-full max-w-[80rem] items-center gap-2 px-3 py-2 sm:px-6">
          <NavLink to="/" className="flex min-h-11 min-w-0 items-center gap-2 rounded-md pr-2 font-semibold">
            <MonitorSmartphoneIcon className="size-6 shrink-0" aria-hidden="true" />
            <span className="truncate text-base sm:text-lg">IT Equipment Checkout</span>
          </NavLink>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#F8F4E9] hover:bg-white/15",
                    isActive && "bg-[#F8F4E9] text-[#502D55] hover:bg-[#F8F4E9]",
                  )
                }
              >
                <n.icon className="size-4" aria-hidden="true" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle compact />
            <UserMenu />
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none lg:pb-0">
        <Gate>
          <motion.div
            key={pathname}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="px-safe mx-auto w-full max-w-[80rem] flex-1 px-3 py-4 sm:px-6 sm:py-6"
          >
            <Outlet />
          </motion.div>
        </Gate>
      </main>
      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:hidden">
        <ul className="mx-auto grid max-w-[40rem]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted-foreground",
                    isActive && "text-foreground [&>svg]:text-[color:var(--link)]",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <n.icon className="size-5" aria-hidden="true" />
                    <span className={cn("truncate", isActive && "font-bold underline decoration-2 underline-offset-4")}>{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Toaster position="top-center" />
    </div>
  );
}

export default AppShell;
