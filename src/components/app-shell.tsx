import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  EyeIcon,
  UndoIcon,
  FlaskConicalIcon,
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
import { useIsDark, useSession, useSettings, useSystemThemeSync, useTheme, useViewAs, type ThemeChoice } from "@/lib/app-data";
import { initials, type Role } from "@/lib/domain";
import { useConfirm } from "@/hooks/use-confirm";
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

function ThemeToggle() {
  const choice = useTheme((s) => s.choice);
  const set = useTheme((s) => s.set);
  const Icon = THEME_ICON[choice];
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => set(NEXT_THEME[choice])}
      className="min-h-11 min-w-11 gap-1.5 text-header-foreground hover:bg-header-hover hover:text-header-foreground"
      aria-label={`Theme: ${THEME_LABEL[choice]}. Switch to ${THEME_LABEL[NEXT_THEME[choice]]}`}
    >
      <Icon aria-hidden="true" />
      <span className="hidden md:inline">{THEME_LABEL[choice]}</span>
    </Button>
  );
}

function hasUnsavedDraft(): boolean {
  try {
    const co = JSON.parse(window.sessionStorage.getItem("itec.checkoutDraft") ?? "null");
    if (co && (String(co.purpose ?? "").trim() || String(co.notes ?? "").trim())) return true;
    return !!window.sessionStorage.getItem("itec.equipmentDraft");
  } catch {
    return false;
  }
}
function clearDrafts() {
  try {
    window.sessionStorage.removeItem("itec.checkoutDraft");
    window.sessionStorage.removeItem("itec.equipmentDraft");
  } catch {
    /* ignore */
  }
}

/** Switch the effective role, warning first when a form has unsaved input. */
function useSwitchRole() {
  const confirm = useConfirm();
  const setViewAs = useViewAs((s) => s.set);
  const { data: session } = useSession();
  return async (to: Role) => {
    if (!session || to === session.role) return;
    if (hasUnsavedDraft()) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "You have a form with unsaved input. Switching role will discard it.",
        confirmLabel: "Switch role",
        destructive: true,
      });
      if (!ok) return;
      clearDrafts();
    }
    setViewAs(to === session.realRole ? null : to);
  };
}

function RoleChip({ role, viewing }: { role: Role; viewing?: boolean }) {
  return (
    <span className="status-badge inline-flex items-center gap-1 rounded-full border border-header-foreground/60 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-header-foreground">
      {viewing ? <EyeIcon className="size-3" aria-hidden="true" /> : role === "IT Admin" ? <ShieldCheckIcon className="size-3" aria-hidden="true" /> : <UserCircle2Icon className="size-3" aria-hidden="true" />}
      {role}
    </span>
  );
}

function ProfileMenu() {
  const { data: session, canSwitch, demoRoleSwitch, isViewingAs } = useSession();
  const choice = useTheme((s) => s.choice);
  const set = useTheme((s) => s.set);
  const switchRole = useSwitchRole();
  const name = session?.me?.name ?? session?.fullName ?? "Signed in";
  const role = session?.role ?? "Employee";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-11 min-w-11 gap-2 px-1.5 text-header-foreground hover:bg-header-hover hover:text-header-foreground sm:px-2"
          aria-label={`Profile: ${name}, role ${role}${isViewingAs ? " (viewing as)" : ""}. Open profile menu`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-header-active text-xs font-bold text-header-active-foreground" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline lg:max-w-40" aria-hidden="true">{name}</span>
          <span aria-hidden="true"><RoleChip role={role} viewing={isViewingAs} /></span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-1rem))]">
        <DropdownMenuLabel className="flex flex-col gap-1 py-2">
          <span className="text-sm font-semibold break-words">{name}</span>
          <span className="text-xs font-normal break-all text-muted-foreground">{session?.me?.email ?? "Email unavailable"}</span>
          <span className="text-xs font-normal text-muted-foreground">Department: {session?.appUser?.department?.replace("[SAMPLE]", "").trim() || "Not set"}</span>
          <span className="mt-1 text-xs font-normal">
            Role: <strong>{session?.realRole ?? "Employee"}</strong>
            {isViewingAs && <> · viewing as <strong>{role}</strong></>}
          </span>
        </DropdownMenuLabel>
        {canSwitch && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Switch role</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={role} onValueChange={(v) => void switchRole(v as Role)}>
              {(["Employee", "IT Admin"] as Role[]).map((r) => (
                <DropdownMenuRadioItem key={r} value={r} className="min-h-11">
                  {r}
                  {r === session?.realRole ? " (your role)" : ""}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {demoRoleSwitch && (
              <p className="flex items-start gap-1.5 px-2 pb-1 text-xs font-medium text-warning">
                <FlaskConicalIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Demo role switching is on for everyone.
              </p>
            )}
          </>
        )}
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

function ViewAsBanner() {
  const { data: session, isViewingAs } = useSession();
  const switchRole = useSwitchRole();
  if (!session || !isViewingAs) return null;
  return (
    <div role="status" className="border-b-2 border-warning bg-card px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <EyeIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <strong>Viewing as {session.role}.</strong> Your real role is {session.realRole}; actions are still recorded as you.
          </span>
        </p>
        <Button variant="outline" className="min-h-11" onClick={() => void switchRole(session.realRole ?? "Employee")}>
          <UndoIcon aria-hidden="true" /> Switch back
        </Button>
      </div>
    </div>
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
  const realAdmin = session.realRole === "IT Admin";
  return (
    <>
      <ViewAsBanner />
      {realAdmin && settings.data?.demoRoleSwitch && (
        <div role="alert" className="border-b-2 border-warning bg-card px-4 py-2 text-sm">
          <div className="mx-auto flex max-w-[80rem] items-start gap-2">
            <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p>
              <strong>Demo role switching is ON.</strong> Any active user can switch to IT Admin in the app. Set DemoRoleSwitch to No in the AppSettings list when the demo is over.
            </p>
          </div>
        </div>
      )}
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
      {realAdmin && settings.data && settings.data.warnings.length > 0 && (
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
  const isDark = useIsDark();
  const { data: session } = useSession();
  const admin = session?.role === "IT Admin";
  const navigate = useNavigate();
  useEffect(() => {
    if (session && !admin && pathname.startsWith("/admin")) navigate("/", { replace: true });
  }, [session, admin, pathname, navigate]);
  const items = NAV.filter((n) => !n.admin || admin);
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main-content" className="sr-only z-[60] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="app-header pt-safe sticky top-0 z-40">
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
                    "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-header-foreground hover:bg-header-hover",
                    isActive && "bg-header-active text-header-active-foreground hover:bg-header-active",
                  )
                }
              >
                <n.icon className="size-4" aria-hidden="true" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <ProfileMenu />
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
      <nav aria-label="Main" className="surface-float pb-safe fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 lg:hidden">
        <ul className="mx-auto grid max-w-[40rem]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted-foreground",
                    isActive && "text-foreground [&>svg]:text-primary",
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
      <Toaster position="top-center" theme={isDark ? "dark" : "light"} />
    </div>
  );
}

export default AppShell;
