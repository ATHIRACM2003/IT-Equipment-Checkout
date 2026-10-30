// Domain model for the IT Equipment Checkout app.
// Lookup and person fields are kept as objects (id + display value), never plain text.

export type EquipmentStatus = "Available" | "Checked out" | "In repair" | "Retired";
export type DisplayStatus = EquipmentStatus | "Overdue";
export type Role = "Employee" | "IT Admin";

export interface PersonRef {
  email: string;
  name: string;
  claims: string;
}

export interface LookupRef {
  id: number;
  value: string;
}

export interface Location {
  id: number;
  name: string;
  active: boolean;
}

export interface Equipment {
  id: number;
  tag: string;
  type: string;
  model: string;
  serial: string;
  status: string;
  condition: string;
  location: LookupRef | null;
  /** Location id was set but the target could not be resolved (deleted/renamed). */
  locationMissing: boolean;
  holder: PersonRef | null;
  dueDate: string | null;
  notes: string;
  modified: string;
}

export interface Checkout {
  id: number;
  title: string;
  equipment: LookupRef | null;
  equipmentMissing: boolean;
  borrower: PersonRef | null;
  checkoutDate: string | null;
  dueDate: string | null;
  returnedDate: string | null;
  returnedBy: PersonRef | null;
  state: string;
  purpose: string;
  notes: string;
}

export interface AppUser {
  id: number;
  name: string;
  user: PersonRef | null;
  role: Role;
  active: boolean;
  department: string;
  maxActive: number | null;
}

export interface Settings {
  maxActiveCheckouts: number;
  maxLoanDays: number;
  blockIfOverdue: boolean;
  pageSize: number;
  warnings: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  maxActiveCheckouts: 3,
  maxLoanDays: 30,
  blockIfOverdue: true,
  pageSize: 25,
  warnings: [],
};

export const SAMPLE_MARKER = "[SAMPLE]";

export const TYPE_PREFIX: Record<string, string> = {
  Laptop: "LT",
  Monitor: "MN",
  Phone: "PH",
  Dock: "DK",
  Other: "OT",
};

export const LIMITS = {
  tag: 20,
  serial: 50,
  model: 100,
  purpose: 255,
  notes: 2000,
  location: 80,
  department: 80,
};

export const TAG_PATTERN = /^[A-Z]{2,4}-\d{4,6}$/;

// ---------- Dates (date-only, timezone-safe) ----------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's local calendar date as YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** SharePoint returns date-only values as midnight UTC; keep the calendar date as stored. */
export function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const head = value.slice(0, 10);
  return isValidISODate(head) ? head : null;
}

export function isValidISODate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= dim;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Due today is NOT overdue. */
export function isOverdue(dueDate: string | null, today = todayISO()): boolean {
  return !!dueDate && dueDate < today;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export function formatDate(iso: string | null): string {
  if (!iso || !isValidISODate(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return dateFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Value sent to SharePoint for a date-only column. */
export function toSpDate(iso: string): string {
  return `${iso}T00:00:00Z`;
}

// ---------- Status ----------

export function displayStatus(e: Pick<Equipment, "status" | "dueDate">, today = todayISO()): DisplayStatus {
  if (e.status === "Checked out" && isOverdue(e.dueDate, today)) return "Overdue";
  return (["Available", "Checked out", "In repair", "Retired"].includes(e.status) ? e.status : "Retired") as DisplayStatus;
}

// ---------- Text safety ----------

/** Trim and collapse internal control characters. React escapes on render; this handles input hygiene. */
export function cleanText(value: string): string {
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) continue;
    out += ch;
  }
  return out.trim();
}

/** Escape a value for an OData string literal. */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function claimsFor(email: string): string {
  return `i:0#.f|membership|${email.toLowerCase()}`;
}

export function samePerson(a: PersonRef | null | undefined, b: PersonRef | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.email && b.email) return a.email.toLowerCase() === b.email.toLowerCase();
  return a.claims.toLowerCase() === b.claims.toLowerCase();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function suggestTag(type: string): string {
  return `${TYPE_PREFIX[type] ?? "OT"}-`;
}
