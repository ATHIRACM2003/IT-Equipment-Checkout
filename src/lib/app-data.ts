import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { EquipmentService, AppUsersService } from "../../generated";
import { fetchAppUsers, fetchLocations, fetchSettings, loadSession, type Session } from "./api";
import { DEFAULT_SETTINGS } from "./domain";

// ---------------------------------------------------------------- theme
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "itec.theme";

function readStoredTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const dark = choice === "dark" || (choice === "system" && systemDark());
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

// Applied at module evaluation, before React renders, so a stored choice
// does not flash the other theme once the script has loaded.
if (typeof document !== "undefined") applyTheme(readStoredTheme());

interface ThemeState {
  choice: ThemeChoice;
  set: (c: ThemeChoice) => void;
}
export const useTheme = create<ThemeState>((set) => ({
  choice: typeof window !== "undefined" ? readStoredTheme() : "system",
  set: (choice) => {
    try {
      if (choice === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* storage unavailable: still applies for this session */
    }
    applyTheme(choice);
    set({ choice });
  },
}));

export function useSystemThemeSync() {
  const choice = useTheme((s) => s.choice);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const fn = () => choice === "system" && applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [choice]);
}

export function useIsDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

// ---------------------------------------------------------------- network
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

// ---------------------------------------------------------------- reference data
export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: fetchSettings, staleTime: 5 * 60_000 });
}
export function useSettingsValue() {
  const q = useSettings();
  return q.data ?? { ...DEFAULT_SETTINGS, rows: [] };
}
export function useLocations() {
  return useQuery({ queryKey: ["locations"], queryFn: fetchLocations, staleTime: 5 * 60_000 });
}
export function useAppUsers() {
  return useQuery({ queryKey: ["appUsers"], queryFn: fetchAppUsers, staleTime: 60_000 });
}

export function useSession() {
  const users = useAppUsers();
  const q = useQuery<Session>({
    queryKey: ["session", users.dataUpdatedAt],
    queryFn: () => loadSession(users.data ?? []),
    enabled: users.isSuccess,
    staleTime: Infinity,
  });
  return { ...q, usersQuery: users };
}

// ---------------------------------------------------------------- configured choices
type ChoiceField = "Type" | "Status" | "Condition" | "Role";

function parseChoices(payload: unknown): string[] {
  const raw = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "value" in payload && Array.isArray((payload as { value: unknown }).value)
      ? (payload as { value: unknown[] }).value
      : null;
  if (raw === null) throw new Error("Unsupported SharePoint Choice response shape");
  return raw.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "Value" in item && typeof (item as { Value: unknown }).Value === "string") {
      return (item as { Value: string }).Value;
    }
    throw new Error("Unsupported SharePoint Choice item");
  });
}

export function useChoices(field: ChoiceField) {
  return useQuery({
    queryKey: ["choices", field],
    staleTime: Infinity,
    queryFn: async () => {
      const r = field === "Role" ? await AppUsersService.getReferencedEntity("", "Role") : await EquipmentService.getReferencedEntity("", field);
      if (!r.success) {
        console.error("choice load failed", r.error);
        throw r.error;
      }
      return parseChoices(r.data);
    },
  });
}

// ---------------------------------------------------------------- media
export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setM(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return m;
}
export const usePhone = () => useMedia("(max-width: 639.98px)");
