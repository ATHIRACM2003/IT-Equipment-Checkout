// Data layer over the five bound SharePoint lists. Every read and write goes
// through the generated connector clients; no credentials live in the app.
import type { IOperationResult } from "@microsoft/managed-apps/data";
import { getUser } from "@microsoft/managed-apps/auth";
import { imageExists } from "./images";
import {
  AppSettingsService,
  AppUsersService,
  CheckoutsService,
  EquipmentService,
  LocationsService,
} from "../../generated";
import type { EquipmentRead, EquipmentWrite } from "../../generated/models/EquipmentModel";
import type { CheckoutsRead, CheckoutsWrite } from "../../generated/models/CheckoutsModel";
import type { AppUsersRead, AppUsersWrite } from "../../generated/models/AppUsersModel";
import type { LocationsRead } from "../../generated/models/LocationsModel";
import type { IGetAllOptions } from "../../generated/models/CommonModels";
import {
  type AppUser,
  type Checkout,
  type Equipment,
  type Location,
  type LookupRef,
  type PersonRef,
  type Role,
  type Settings,
  DEFAULT_SETTINGS,
  SAMPLE_MARKER,
  addDays,
  claimsFor,
  isOverdue,
  odataString,
  samePerson,
  toDateOnly,
  toSpDate,
  todayISO,
} from "./domain";

// ---------------------------------------------------------------- errors

export type ErrorKind =
  | "throttled"
  | "auth"
  | "forbidden"
  | "missing"
  | "network"
  | "conflict"
  | "validation"
  | "unknown";

export class AppError extends Error {
  kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function statusOf(err: unknown, depth = 0): number | undefined {
  if (!err || typeof err !== "object" || depth > 3) return undefined;
  const rec = err as Record<string, unknown>;
  for (const k of ["status", "statusCode", "httpStatus", "code"]) {
    const v = rec[k];
    if (typeof v === "number" && v >= 100 && v < 600) return v;
    if (typeof v === "string" && /^\d{3}$/.test(v)) return Number(v);
  }
  return statusOf(rec.cause ?? rec.error, depth + 1);
}

function messageOf(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err).slice(0, 400);
  } catch {
    return String(err);
  }
}

export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const status = statusOf(err);
  const msg = messageOf(err).toLowerCase();
  if (status === 429 || msg.includes("429") || msg.includes("throttl") || msg.includes("too many requests")) {
    return new AppError("throttled", "SharePoint is busy right now. We retried a few times; please try again in a moment.");
  }
  if (status === 401 || msg.includes("401") || msg.includes("unauthorized") || msg.includes("token") && msg.includes("expired")) {
    return new AppError("auth", "Your sign-in has expired. Refresh the app to sign in again — what you typed is kept.");
  }
  if (status === 403 || msg.includes("403") || msg.includes("forbidden") || msg.includes("access denied")) {
    return new AppError("forbidden", "You don't have permission for this action on the SharePoint site. Ask an IT admin or the site owner.");
  }
  if (status === 404 || msg.includes("404") || msg.includes("does not exist") || msg.includes("not found")) {
    return new AppError("missing", "A list or column the app needs is missing or was renamed on the SharePoint site. Ask an IT admin to check the setup.");
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout") || msg.includes("offline")) {
    return new AppError("network", "SharePoint can't be reached. Check your connection and try again.");
  }
  return new AppError("unknown", "Something went wrong talking to SharePoint. Try again.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Page<T> {
  rows: T[];
  next?: string;
}

/** Runs one connector call, retrying throttling (429) with backoff. */
async function call<T>(fn: () => Promise<IOperationResult<T>>): Promise<{ data: T; skipToken?: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fn();
      if (r.success) return { data: r.data as T, skipToken: r.skipToken?.trim() || undefined };
      lastErr = r.error;
    } catch (e) {
      lastErr = e;
    }
    const kind = classifyError(lastErr).kind;
    if (kind !== "throttled" && kind !== "network") break;
    if (attempt < 3) await sleep(800 * 2 ** attempt + Math.random() * 300);
  }
  console.error("connector error", lastErr);
  throw Object.assign(classifyError(lastErr), { raw: lastErr });
}

async function callVoid(fn: () => Promise<void>): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      lastErr = e;
    }
    if (classifyError(lastErr).kind !== "throttled") break;
    if (attempt < 3) await sleep(800 * 2 ** attempt);
  }
  console.error("connector error", lastErr);
  throw classifyError(lastErr);
}

// ---------------------------------------------------------------- filter variants
// Each server-side clause is tried in a known-good OData form first; the first form
// SharePoint accepts is remembered. If none is accepted the clause is applied
// client-side on the returned page so the screen still works.

type ClauseKind = "choice" | "lookup" | "person" | "search" | "text";
interface Clause<T> {
  kind: ClauseKind;
  variants: string[];
  test: (row: T) => boolean;
}
const variantCache: Partial<Record<ClauseKind, number>> = {};

async function query<R, T>(
  fetcher: (opts: IGetAllOptions) => Promise<IOperationResult<R[]>>,
  map: (r: R) => T,
  clauses: Clause<T>[],
  opts: { top: number; skipToken?: string; orderBy?: string[] },
): Promise<Page<T>> {
  const idx = clauses.map((c) => variantCache[c.kind] ?? 0);
  for (let attempt = 0; attempt < 10; attempt++) {
    const server = clauses.map((c, i) => (idx[i] >= 0 && idx[i] < c.variants.length ? c.variants[idx[i]] : null));
    const filter = server.filter(Boolean).map((f) => `(${f})`).join(" and ") || undefined;
    try {
      const { data, skipToken } = await call(() =>
        fetcher({ filter, top: opts.top, orderBy: opts.orderBy, skipToken: opts.skipToken }),
      );
      clauses.forEach((c, i) => {
        variantCache[c.kind] = idx[i] >= c.variants.length ? -1 : idx[i];
      });
      let rows = (Array.isArray(data) ? data : []).map(map);
      clauses.forEach((c, i) => {
        if (server[i] === null) rows = rows.filter(c.test);
      });
      return { rows, next: skipToken };
    } catch (e) {
      const err = e as AppError;
      if (err.kind !== "unknown" && err.kind !== "missing") throw err;
      // advance the first clause whose form isn't confirmed yet
      const j = clauses.findIndex((c, i) => idx[i] >= 0 && idx[i] < c.variants.length && variantCache[c.kind] === undefined);
      const k = j >= 0 ? j : clauses.findIndex((_, i) => idx[i] >= 0 && idx[i] < clauses[i].variants.length);
      if (k < 0) throw err;
      idx[k] = idx[k] + 1 >= clauses[k].variants.length ? -1 : idx[k] + 1;
    }
  }
  throw new AppError("unknown", "Couldn't load data from SharePoint. Try again.");
}

const choiceClause = <T,>(field: string, value: string, get: (r: T) => string): Clause<T> => ({
  kind: "choice",
  variants: [`${field} eq ${odataString(value)}`, `${field}/Value eq ${odataString(value)}`],
  test: (r) => get(r) === value,
});
const lookupClause = <T,>(field: string, id: number, get: (r: T) => number | undefined): Clause<T> => ({
  kind: "lookup",
  variants: [`${field}/Id eq ${id}`, `${field}Id eq ${id}`],
  test: (r) => get(r) === id,
});
const personClause = <T,>(field: string, email: string, get: (r: T) => PersonRef | null): Clause<T> => ({
  kind: "person",
  variants: [`${field}/EMail eq ${odataString(email)}`, `${field}/Email eq ${odataString(email)}`],
  test: (r) => (get(r)?.email ?? "").toLowerCase() === email.toLowerCase(),
});
const textEqClause = <T,>(field: string, value: string, get: (r: T) => string): Clause<T> => ({
  kind: "text",
  variants: [`${field} eq ${odataString(value)}`],
  test: (r) => get(r).toLowerCase() === value.toLowerCase(),
});
const searchClause = <T,>(term: string, fields: string[], get: (r: T) => string[]): Clause<T> => {
  const q = odataString(term);
  return {
    kind: "search",
    variants: [
      fields.map((f) => `substringof(${q},${f})`).join(" or "),
      fields.map((f) => `contains(${f},${q})`).join(" or "),
      fields.map((f) => `startswith(${f},${q})`).join(" or "),
    ],
    test: (r) => get(r).some((v) => v.toLowerCase().includes(term.toLowerCase())),
  };
};

// ---------------------------------------------------------------- mapping

type AnyPerson = { Claims?: string; DisplayName?: string; Email?: string } | null | undefined;
function person(p: AnyPerson): PersonRef | null {
  if (!p || (!p.Email && !p.Claims)) return null;
  const email = (p.Email || (p.Claims ?? "").split("|").pop() || "").toLowerCase();
  return { email, name: p.DisplayName || email || "Unknown person", claims: p.Claims || claimsFor(email) };
}
function lookup(v: { Id?: number; Value?: string } | null | undefined, rawId: number | undefined): { ref: LookupRef | null; missing: boolean } {
  if (v && typeof v.Id === "number" && v.Id > 0) {
    return { ref: { id: v.Id, value: v.Value ?? "" }, missing: !v.Value };
  }
  if (typeof rawId === "number" && rawId > 0) return { ref: { id: rawId, value: "" }, missing: true };
  return { ref: null, missing: false };
}

export function mapEquipment(r: EquipmentRead): Equipment {
  const loc = lookup(r.Location, r["Location#Id"]);
  return {
    id: r.ID ?? 0,
    tag: r.Title ?? "",
    type: r.Type?.Value ?? "Other",
    model: r.MakeModel ?? "",
    serial: r.SerialNumber ?? "",
    status: r.Status?.Value ?? "Available",
    condition: r.Condition?.Value ?? "Good",
    location: loc.ref,
    locationMissing: loc.missing,
    holder: person(r.CurrentHolder),
    dueDate: toDateOnly(r.CurrentDueDate),
    notes: r.Notes ?? "",
    modified: r.Modified ?? "",
    photoPath: (r.PhotoPath ?? "").trim(),
  };
}

export function mapCheckout(r: CheckoutsRead): Checkout {
  const eq = lookup(r.Equipment, r["Equipment#Id"]);
  return {
    id: r.ID ?? 0,
    title: r.Title ?? "",
    equipment: eq.ref,
    equipmentMissing: eq.missing,
    borrower: person(r.Borrower),
    checkoutDate: toDateOnly(r.CheckoutDate),
    dueDate: toDateOnly(r.DueDate),
    returnedDate: toDateOnly(r.ReturnedDate),
    returnedBy: person(r.ReturnedBy),
    state: r.State?.Value ?? "Active",
    purpose: r.Purpose ?? "",
    notes: r.Notes ?? "",
  };
}

function mapLocation(r: LocationsRead): Location {
  return { id: r.ID ?? 0, name: r.Title ?? "", active: r.Active !== false };
}

function mapAppUser(r: AppUsersRead): AppUser {
  const role = (r.Role?.Value === "IT Admin" ? "IT Admin" : "Employee") as Role;
  const max = typeof r.MaxActiveCheckouts === "number" && r.MaxActiveCheckouts > 0 ? r.MaxActiveCheckouts : null;
  return {
    id: r.ID ?? 0,
    name: r.Title ?? "",
    user: person(r.User),
    role,
    active: r.Active !== false,
    department: r.Department ?? "",
    maxActive: max,
  };
}

// ---------------------------------------------------------------- write helpers

const PERSON_TYPE = "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedUser";
const REF_TYPE = "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedReference";

function personWrite(p: PersonRef) {
  return {
    "@odata.type": PERSON_TYPE,
    Claims: p.claims || claimsFor(p.email),
    DisplayName: p.name,
    Email: p.email,
    Picture: "",
    Department: "",
    JobTitle: "",
  };
}
function refWrite(r: LookupRef) {
  return { "@odata.type": REF_TYPE, Id: r.id, Value: r.value };
}
// SharePoint accepts null to clear person/date columns.
const CLEAR = null as unknown as undefined;

// ---------------------------------------------------------------- session

export interface Session {
  fullName: string;
  /** Role from AppUsers. `role` is the effective (possibly "viewing as") role. */
  realRole?: Role;
  me: PersonRef | null;
  appUser: AppUser | null;
  role: Role;
  blocked: boolean;
  noActiveAdmin: boolean;
  identityAmbiguous: boolean;
}

function parsePeople(payload: unknown): PersonRef[] {
  const arr = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "value" in payload && Array.isArray((payload as { value: unknown }).value)
      ? ((payload as { value: unknown[] }).value)
      : null;
  if (!arr) throw new AppError("unknown", "Unsupported people response");
  return arr
    .map((x) => person(x as AnyPerson))
    .filter((p): p is PersonRef => !!p && !!p.email);
}

/** Directory search through the SharePoint people picker of a bound list. */
export async function searchPeople(term: string): Promise<PersonRef[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const { data } = await call(() => AppUsersService.getReferencedEntity(t, "User"));
  return parsePeople(data);
}

export async function loadSession(appUsers: AppUser[]): Promise<Session> {
  let fullName = "";
  try {
    const u = await getUser();
    fullName = u.fullName ?? "";
  } catch (e) {
    console.error("getUser failed", e);
    throw new AppError("auth", "We couldn't confirm who is signed in. Refresh the app to sign in again.");
  }
  let me: PersonRef | null = null;
  let identityAmbiguous = false;
  const nameKey = fullName.trim().toLowerCase();
  const listed = appUsers.filter((a) => (a.user?.name ?? a.name).trim().toLowerCase() === nameKey);
  try {
    const people = (await searchPeople(fullName)).filter((p) => p.name.trim().toLowerCase() === nameKey);
    if (people.length === 1) me = people[0];
    else if (people.length > 1) {
      me = people.find((p) => listed.some((a) => samePerson(a.user, p))) ?? people[0];
      identityAmbiguous = !people.some((p) => listed.some((a) => samePerson(a.user, p)));
    }
  } catch (e) {
    console.error("people search failed", e);
  }
  if (!me && listed.length === 1 && listed[0].user) me = listed[0].user;
  const appUser = me ? (appUsers.find((a) => samePerson(a.user, me)) ?? null) : null;
  const noActiveAdmin = !appUsers.some((a) => a.active && a.role === "IT Admin");
  return {
    fullName,
    me,
    appUser,
    role: appUser && appUser.active && appUser.role === "IT Admin" ? "IT Admin" : "Employee",
    blocked: !!appUser && !appUser.active,
    noActiveAdmin,
    identityAmbiguous,
  };
}

// ---------------------------------------------------------------- reference data

export async function fetchSettings(): Promise<Settings & { rows: { id: number; key: string; value: string }[] }> {
  const { data } = await call(() => AppSettingsService.getAll({ top: 200 }));
  const rows = (data ?? []).map((r) => ({ id: r.ID ?? 0, key: (r.Title ?? "").trim(), value: (r.Value ?? "").trim() }));
  const s: Settings = { ...DEFAULT_SETTINGS, warnings: [] };
  const seen = new Map<string, number>();
  rows.forEach((r) => seen.set(r.key.toLowerCase(), (seen.get(r.key.toLowerCase()) ?? 0) + 1));
  const num = (key: string, fallback: number, min: number, max: number): number => {
    const k = key.toLowerCase();
    const hits = rows.filter((r) => r.key.toLowerCase() === k);
    if (hits.length === 0) {
      s.warnings.push(`Setting "${key}" is missing — using the default (${fallback}).`);
      return fallback;
    }
    if (hits.length > 1) s.warnings.push(`Setting "${key}" appears ${hits.length} times — using the first value.`);
    const n = Number(hits[0].value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
      s.warnings.push(`Setting "${key}" has an invalid value — using the default (${fallback}).`);
      return fallback;
    }
    return n;
  };
  s.maxActiveCheckouts = num("MaxActiveCheckouts", 3, 1, 100);
  s.maxLoanDays = num("MaxLoanDays", 30, 1, 365);
  s.pageSize = num("PageSize", 25, 5, 100);
  const block = rows.filter((r) => r.key.toLowerCase() === "blockifoverdue");
  if (block.length === 0) s.warnings.push(`Setting "BlockIfOverdue" is missing — using the default (Yes).`);
  else {
    if (block.length > 1) s.warnings.push(`Setting "BlockIfOverdue" appears ${block.length} times — using the first value.`);
    const v = block[0].value.toLowerCase();
    if (["yes", "true", "1"].includes(v)) s.blockIfOverdue = true;
    else if (["no", "false", "0"].includes(v)) s.blockIfOverdue = false;
    else s.warnings.push(`Setting "BlockIfOverdue" has an invalid value — using the default (Yes).`);
  }
  const demo = rows.filter((r) => r.key.toLowerCase() === "demoroleswitch");
  if (demo.length > 0) {
    if (demo.length > 1) s.warnings.push(`Setting "DemoRoleSwitch" appears ${demo.length} times — using the first value.`);
    const v = demo[0].value.toLowerCase();
    if (["yes", "true", "1"].includes(v)) s.demoRoleSwitch = true;
    else if (!["no", "false", "0", ""].includes(v)) s.warnings.push(`Setting "DemoRoleSwitch" has an invalid value — using the default (No).`);
  }
  return { ...s, rows };
}

export async function fetchLocations(): Promise<Location[]> {
  const { data } = await call(() => LocationsService.getAll({ top: 500, orderBy: ["Title asc"] }));
  return (data ?? []).map(mapLocation);
}

export async function fetchAppUsers(): Promise<AppUser[]> {
  const { data } = await call(() => AppUsersService.getAll({ top: 1000, orderBy: ["Title asc"] }));
  return (data ?? []).map(mapAppUser);
}

// ---------------------------------------------------------------- equipment

export interface EquipmentFilter {
  search?: string;
  type?: string;
  status?: string;
  locationId?: number;
}

export async function fetchEquipmentPage(f: EquipmentFilter, top: number, skipToken?: string): Promise<Page<Equipment>> {
  const clauses: Clause<Equipment>[] = [];
  if (f.type) clauses.push(choiceClause("Type", f.type, (e) => e.type));
  if (f.status) clauses.push(choiceClause("Status", f.status, (e) => e.status));
  if (f.locationId) clauses.push(lookupClause("Location", f.locationId, (e) => e.location?.id));
  const term = f.search?.trim();
  if (term) clauses.push(searchClause(term, ["Title", "MakeModel", "SerialNumber"], (e) => [e.tag, e.model, e.serial]));
  return query((o) => EquipmentService.getAll(o), mapEquipment, clauses, { top, skipToken, orderBy: ["Title asc"] });
}

export async function getEquipment(id: number): Promise<Equipment> {
  const { data } = await call(() => EquipmentService.get(String(id)));
  return mapEquipment(data);
}

/** Bounded scan of equipment for dashboards/integrity. Returns `truncated` when the cap was hit. */
export async function scanEquipment(maxRows = 2500): Promise<{ rows: Equipment[]; truncated: boolean }> {
  const rows: Equipment[] = [];
  let token: string | undefined;
  do {
    const page = await query((o) => EquipmentService.getAll(o), mapEquipment, [], { top: 500, skipToken: token });
    rows.push(...page.rows);
    token = page.next;
  } while (token && rows.length < maxRows);
  return { rows, truncated: !!token };
}

async function findEquipmentBy(field: "Title" | "SerialNumber", value: string): Promise<Equipment[]> {
  const page = await query(
    (o) => EquipmentService.getAll(o),
    mapEquipment,
    [textEqClause(field, value, (e) => (field === "Title" ? e.tag : e.serial))],
    { top: 5 },
  );
  return page.rows.filter((e) => (field === "Title" ? e.tag : e.serial).toLowerCase() === value.toLowerCase());
}

export async function checkUnique(tag: string, serial: string, exceptId?: number): Promise<{ tag?: string; serial?: string }> {
  const [a, b] = await Promise.all([findEquipmentBy("Title", tag), findEquipmentBy("SerialNumber", serial)]);
  const out: { tag?: string; serial?: string } = {};
  if (a.some((e) => e.id !== exceptId)) out.tag = "This asset tag is already used by another item.";
  if (b.some((e) => e.id !== exceptId)) out.serial = "This serial number is already used by another item.";
  return out;
}

export interface EquipmentInput {
  tag: string;
  type: string;
  model: string;
  serial: string;
  condition: string;
  location: LookupRef;
  notes: string;
  status?: string;
  photoPath?: string;
}

export async function createEquipment(input: EquipmentInput): Promise<Equipment> {
  const rec: Omit<EquipmentWrite, "ID"> = {
    Title: input.tag,
    Type: { Value: input.type },
    MakeModel: input.model,
    SerialNumber: input.serial,
    Status: { Value: "Available" },
    Condition: { Value: input.condition },
    Location: refWrite(input.location),
    Notes: input.notes,
    PhotoPath: input.photoPath ?? "",
  };
  const { data } = await call(() => EquipmentService.create(rec));
  return mapEquipment(data);
}

export async function updateEquipment(id: number, changes: Partial<EquipmentInput>): Promise<Equipment> {
  const rec: Partial<Omit<EquipmentWrite, "ID">> = {};
  if (changes.tag !== undefined) rec.Title = changes.tag;
  if (changes.type !== undefined) rec.Type = { Value: changes.type };
  if (changes.model !== undefined) rec.MakeModel = changes.model;
  if (changes.serial !== undefined) rec.SerialNumber = changes.serial;
  if (changes.condition !== undefined) rec.Condition = { Value: changes.condition };
  if (changes.location !== undefined) rec.Location = refWrite(changes.location);
  if (changes.notes !== undefined) rec.Notes = changes.notes;
  if (changes.status !== undefined) rec.Status = { Value: changes.status };
  if (changes.photoPath !== undefined) rec.PhotoPath = changes.photoPath;
  const { data } = await call(() => EquipmentService.update(String(id), rec));
  return mapEquipment(data);
}

/** Admin status change. In repair/Retired is refused while checked out (re-read first). */
export async function setEquipmentStatus(id: number, status: "Available" | "In repair" | "Retired"): Promise<Equipment> {
  const fresh = await getEquipment(id);
  if (fresh.status === "Checked out" && status !== "Available") {
    throw new AppError("conflict", `${fresh.tag} is checked out. Return it first, then change its status.`);
  }
  const active = await fetchActiveCheckouts({ equipmentId: id });
  if (active.length > 0) {
    throw new AppError("conflict", `${fresh.tag} still has an active checkout. Return it first.`);
  }
  const { data } = await call(() =>
    EquipmentService.update(String(id), { Status: { Value: status }, CurrentHolder: CLEAR, CurrentDueDate: CLEAR }),
  );
  return mapEquipment(data);
}

export async function equipmentHasHistory(id: number): Promise<boolean> {
  const page = await query(
    (o) => CheckoutsService.getAll(o),
    mapCheckout,
    [lookupClause("Equipment", id, (c) => c.equipment?.id)],
    { top: 1 },
  );
  return page.rows.length > 0;
}

export async function deleteEquipment(id: number): Promise<void> {
  if (await equipmentHasHistory(id)) {
    throw new AppError("conflict", "This item has checkout history, so it can't be deleted. Retire it instead.");
  }
  await callVoid(() => EquipmentService.delete(String(id)));
}

// ---------------------------------------------------------------- checkouts

export async function fetchActiveCheckouts(opts: { borrowerEmail?: string; equipmentId?: number } = {}): Promise<Checkout[]> {
  const clauses: Clause<Checkout>[] = [choiceClause("State", "Active", (c) => c.state)];
  if (opts.borrowerEmail) clauses.push(personClause("Borrower", opts.borrowerEmail, (c) => c.borrower));
  if (opts.equipmentId) clauses.push(lookupClause("Equipment", opts.equipmentId, (c) => c.equipment?.id));
  const rows: Checkout[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await query((o) => CheckoutsService.getAll(o), mapCheckout, clauses, { top: 500, skipToken: token });
    rows.push(...page.rows);
    token = page.next;
    pages++;
  } while (token && pages < 6);
  return rows;
}

export async function fetchCheckoutsPage(
  f: { state?: string; equipmentId?: number },
  top: number,
  skipToken?: string,
): Promise<Page<Checkout>> {
  const clauses: Clause<Checkout>[] = [];
  if (f.state) clauses.push(choiceClause("State", f.state, (c) => c.state));
  if (f.equipmentId) clauses.push(lookupClause("Equipment", f.equipmentId, (c) => c.equipment?.id));
  return query((o) => CheckoutsService.getAll(o), mapCheckout, clauses, { top, skipToken, orderBy: ["ID desc"] });
}

export interface CheckoutRequest {
  equipmentId: number;
  borrower: PersonRef;
  dueDate: string;
  purpose: string;
  notes: string;
  settings: Settings;
  maxActive: number;
}

/**
 * Check out an item. Re-reads the item and the borrower's checkouts right before
 * writing, creates the Checkouts row, then updates Equipment. If the second write
 * fails the first is rolled back. A post-write check resolves races.
 */
export async function checkoutItem(req: CheckoutRequest): Promise<Checkout> {
  const today = todayISO();
  const item = await getEquipment(req.equipmentId);
  if (item.status !== "Available") {
    throw new AppError("conflict", `${item.tag} was just taken by someone else or is no longer available.`);
  }
  const existing = await fetchActiveCheckouts({ equipmentId: item.id });
  if (existing.length > 0) {
    throw new AppError("conflict", `${item.tag} was just taken by someone else.`);
  }
  const mine = await fetchActiveCheckouts({ borrowerEmail: req.borrower.email });
  if (mine.length >= req.maxActive) {
    throw new AppError("validation", `You already have ${mine.length} of ${req.maxActive} active checkouts. Return an item first.`);
  }
  if (req.settings.blockIfOverdue && mine.some((c) => isOverdue(c.dueDate, today))) {
    throw new AppError("validation", "You have an overdue item. Return it before checking out anything new.");
  }
  if (req.dueDate < today || req.dueDate > addDays(today, req.settings.maxLoanDays)) {
    throw new AppError("validation", `Due date must be between today and ${req.settings.maxLoanDays} days from today.`);
  }
  const rec: Omit<CheckoutsWrite, "ID"> = {
    Title: `CO-${today.replace(/-/g, "")}-${item.tag}`,
    Equipment: refWrite({ id: item.id, value: item.tag }),
    Borrower: personWrite(req.borrower),
    CheckoutDate: toSpDate(today),
    DueDate: toSpDate(req.dueDate),
    State: { Value: "Active" },
    Purpose: req.purpose,
    Notes: req.notes,
  };
  const created = mapCheckout((await call(() => CheckoutsService.create(rec))).data);
  try {
    await call(() =>
      EquipmentService.update(String(item.id), {
        Status: { Value: "Checked out" },
        CurrentHolder: personWrite(req.borrower),
        CurrentDueDate: toSpDate(req.dueDate),
      }),
    );
  } catch (e) {
    await callVoid(() => CheckoutsService.delete(String(created.id))).catch((rb) => console.error("rollback failed", rb));
    throw new AppError(classifyError(e).kind === "forbidden" ? "forbidden" : "unknown", "The checkout couldn't be completed, so nothing was saved. Try again.");
  }
  // Race check: if someone else's Active checkout for this item landed first, undo ours.
  const after = await fetchActiveCheckouts({ equipmentId: item.id }).catch(() => [] as Checkout[]);
  const winner = after.sort((a, b) => a.id - b.id)[0];
  if (winner && winner.id !== created.id) {
    await callVoid(() => CheckoutsService.delete(String(created.id))).catch(() => undefined);
    if (winner.borrower) {
      await call(() =>
        EquipmentService.update(String(item.id), {
          Status: { Value: "Checked out" },
          CurrentHolder: personWrite(winner.borrower!),
          CurrentDueDate: winner.dueDate ? toSpDate(winner.dueDate) : CLEAR,
        }),
      ).catch(() => undefined);
    }
    throw new AppError("conflict", `${item.tag} was just taken by someone else.`);
  }
  return created;
}

export async function returnCheckout(c: Checkout, by: PersonRef, note?: string): Promise<void> {
  const today = todayISO();
  const fresh = mapCheckout((await call(() => CheckoutsService.get(String(c.id)))).data);
  if (fresh.state !== "Active") throw new AppError("conflict", "This item was already returned.");
  if (fresh.checkoutDate && today < fresh.checkoutDate) {
    throw new AppError("validation", "The return date can't be before the checkout date.");
  }
  const notes = note?.trim() ? `${fresh.notes ? fresh.notes + "\n" : ""}Return note (${today}, ${by.name}): ${note.trim()}` : fresh.notes;
  await call(() =>
    CheckoutsService.update(String(c.id), {
      State: { Value: "Returned" },
      ReturnedDate: toSpDate(today),
      ReturnedBy: personWrite(by),
      Notes: notes,
    }),
  );
  if (!fresh.equipment) return;
  try {
    await call(() =>
      EquipmentService.update(String(fresh.equipment!.id), {
        Status: { Value: "Available" },
        CurrentHolder: CLEAR,
        CurrentDueDate: CLEAR,
      }),
    );
  } catch (e) {
    await call(() =>
      CheckoutsService.update(String(c.id), { State: { Value: "Active" }, ReturnedDate: CLEAR, ReturnedBy: CLEAR, Notes: fresh.notes }),
    ).catch((rb) => console.error("rollback failed", rb));
    throw new AppError(classifyError(e).kind === "forbidden" ? "forbidden" : "unknown", "The return couldn't be completed, so nothing was changed. Try again.");
  }
}

// ---------------------------------------------------------------- locations

export async function saveLocation(id: number | null, name: string, active: boolean): Promise<void> {
  if (id) await call(() => LocationsService.update(String(id), { Title: name, Active: active }));
  else await call(() => LocationsService.create({ Title: name, Active: active }));
}

export async function locationInUse(id: number): Promise<boolean> {
  const page = await query((o) => EquipmentService.getAll(o), mapEquipment, [lookupClause("Location", id, (e) => e.location?.id)], { top: 1 });
  return page.rows.length > 0;
}

export async function deleteLocation(id: number): Promise<void> {
  if (await locationInUse(id)) throw new AppError("conflict", "This location is used by equipment, so it can't be deleted. Mark it inactive instead.");
  await callVoid(() => LocationsService.delete(String(id)));
}

// ---------------------------------------------------------------- app users

export async function saveAppUser(
  id: number | null,
  input: { user: PersonRef; role: Role; active: boolean; department: string; maxActive: number | null },
): Promise<void> {
  const current = await fetchAppUsers();
  if (current.some((a) => a.id !== id && samePerson(a.user, input.user))) {
    throw new AppError("validation", "This person is already in the user list.");
  }
  const admins = current.filter((a) => a.active && a.role === "IT Admin");
  const self = current.find((a) => a.id === id);
  const losingAdmin = self && self.active && self.role === "IT Admin" && (!input.active || input.role !== "IT Admin");
  if (losingAdmin && admins.length <= 1) {
    throw new AppError("validation", "This is the last active IT Admin. Add or activate another admin first.");
  }
  const rec: Partial<Omit<AppUsersWrite, "ID">> = {
    Title: input.user.name,
    User: personWrite(input.user),
    Role: { Value: input.role },
    Active: input.active,
    Department: input.department,
    MaxActiveCheckouts: input.maxActive ?? CLEAR,
  };
  if (id) await call(() => AppUsersService.update(String(id), rec));
  else await call(() => AppUsersService.create(rec as Omit<AppUsersWrite, "ID">));
}

export async function deleteAppUser(id: number): Promise<void> {
  const current = await fetchAppUsers();
  const self = current.find((a) => a.id === id);
  const admins = current.filter((a) => a.active && a.role === "IT Admin");
  if (self && self.active && self.role === "IT Admin" && admins.length <= 1) {
    throw new AppError("validation", "This is the last active IT Admin and can't be removed.");
  }
  await callVoid(() => AppUsersService.delete(String(id)));
}

// ---------------------------------------------------------------- integrity

export type IssueKind =
  | "available-with-active"
  | "checked-out-without-active"
  | "duplicate-active"
  | "holder-mismatch"
  | "unknown-location"
  | "inactive-location"
  | "unknown-item"
  | "inactive-borrower"
  | "missing-image";

export interface Issue {
  key: string;
  kind: IssueKind;
  title: string;
  detail: string;
  equipment?: Equipment;
  checkouts?: Checkout[];
  repairable: boolean;
}

export async function scanIntegrity(locations: Location[], appUsers: AppUser[]): Promise<{ issues: Issue[]; truncated: boolean }> {
  const [{ rows: items, truncated }, active] = await Promise.all([scanEquipment(), fetchActiveCheckouts()]);
  const byItem = new Map<number, Checkout[]>();
  const issues: Issue[] = [];
  const itemIds = new Set(items.map((i) => i.id));
  for (const c of active) {
    if (!c.equipment || c.equipmentMissing || (!truncated && !itemIds.has(c.equipment.id))) {
      issues.push({ key: `ui-${c.id}`, kind: "unknown-item", title: `Checkout ${c.title || c.id} points to an unknown item`, detail: "The linked equipment was deleted or renamed. Force-return closes this checkout.", checkouts: [c], repairable: true });
      continue;
    }
    byItem.set(c.equipment.id, [...(byItem.get(c.equipment.id) ?? []), c]);
    if (c.borrower && !appUsers.some((a) => a.active && samePerson(a.user, c.borrower)) && appUsers.some((a) => samePerson(a.user, c.borrower))) {
      issues.push({ key: `ib-${c.id}`, kind: "inactive-borrower", title: `${c.equipment.value} is held by an inactive user`, detail: `${c.borrower.name} is marked inactive. You can force-return the item.`, checkouts: [c], repairable: false });
    }
  }
  for (const e of items) {
    const list = (byItem.get(e.id) ?? []).sort((a, b) => a.id - b.id);
    if (list.length > 1) {
      issues.push({ key: `dup-${e.id}`, kind: "duplicate-active", title: `${e.tag} has ${list.length} active checkouts`, detail: "Repair keeps the earliest checkout and closes the others.", equipment: e, checkouts: list, repairable: true });
    } else if (list.length === 1 && e.status !== "Checked out") {
      issues.push({ key: `awa-${e.id}`, kind: "available-with-active", title: `${e.tag} is "${e.status}" but has an active checkout`, detail: `Repair marks it Checked out to ${list[0].borrower?.name ?? "the borrower"}.`, equipment: e, checkouts: list, repairable: true });
    } else if (list.length === 0 && e.status === "Checked out") {
      issues.push({ key: `cwa-${e.id}`, kind: "checked-out-without-active", title: `${e.tag} is Checked out with no active checkout`, detail: "Repair marks it Available and clears the holder.", equipment: e, repairable: true });
    } else if (list.length === 1 && (!samePerson(e.holder, list[0].borrower) || e.dueDate !== list[0].dueDate)) {
      issues.push({ key: `hm-${e.id}`, kind: "holder-mismatch", title: `${e.tag} holder or due date disagrees with its checkout`, detail: "Repair copies the borrower and due date from the active checkout.", equipment: e, checkouts: list, repairable: true });
    }
    if (e.location) {
      const loc = locations.find((l) => l.id === e.location!.id);
      if (!loc || e.locationMissing) issues.push({ key: `ul-${e.id}`, kind: "unknown-location", title: `${e.tag} has an unknown location`, detail: "Edit the item and choose an active location.", equipment: e, repairable: false });
      else if (!loc.active) issues.push({ key: `il-${e.id}`, kind: "inactive-location", title: `${e.tag} is at inactive location "${loc.name}"`, detail: "Edit the item and choose an active location.", equipment: e, repairable: false });
    }
  }
  // Missing image: no PhotoPath, or a PhotoPath whose file no longer exists.
  const paths = [...new Set(items.map((e) => e.photoPath).filter(Boolean))];
  const broken = new Set<string>();
  // Limited concurrency; an inconclusive check (throttling, network) is not reported as missing.
  for (let i = 0; i < paths.length; i += 6) {
    await Promise.all(
      paths.slice(i, i + 6).map(async (p) => {
        if (!(await imageExists(p).catch(() => true))) broken.add(p);
      }),
    );
  }
  for (const e of items) {
    if (!e.photoPath || broken.has(e.photoPath)) {
      issues.push({ key: `img-${e.id}`, kind: "missing-image", title: `Missing image: ${e.tag}`, detail: e.photoPath ? "The standard image file was deleted or can't be read. Restore it in the EquipmentImages library." : `There's no standard image for ${e.type} yet. Edit the item to apply the standard image if one exists for its type.`, equipment: e, repairable: false });
    }
  }
  return { issues, truncated };
}

export async function repairIssue(issue: Issue, admin: PersonRef): Promise<void> {
  const today = todayISO();
  const close = (c: Checkout) =>
    call(() =>
      CheckoutsService.update(String(c.id), {
        State: { Value: "Returned" },
        ReturnedDate: toSpDate(today),
        ReturnedBy: personWrite(admin),
        Notes: `${c.notes ? c.notes + "\n" : ""}Closed by integrity repair (${today}).`,
      }),
    );
  switch (issue.kind) {
    case "duplicate-active": {
      const [keep, ...rest] = issue.checkouts!;
      for (const c of rest) await close(c);
      await call(() =>
        EquipmentService.update(String(issue.equipment!.id), {
          Status: { Value: "Checked out" },
          CurrentHolder: keep.borrower ? personWrite(keep.borrower) : CLEAR,
          CurrentDueDate: keep.dueDate ? toSpDate(keep.dueDate) : CLEAR,
        }),
      );
      return;
    }
    case "available-with-active":
    case "holder-mismatch": {
      const c = issue.checkouts![0];
      await call(() =>
        EquipmentService.update(String(issue.equipment!.id), {
          Status: { Value: "Checked out" },
          CurrentHolder: c.borrower ? personWrite(c.borrower) : CLEAR,
          CurrentDueDate: c.dueDate ? toSpDate(c.dueDate) : CLEAR,
        }),
      );
      return;
    }
    case "checked-out-without-active":
      await call(() =>
        EquipmentService.update(String(issue.equipment!.id), { Status: { Value: "Available" }, CurrentHolder: CLEAR, CurrentDueDate: CLEAR }),
      );
      return;
    case "unknown-item":
      await close(issue.checkouts![0]);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- sample data

async function scanAll<R, T>(fetcher: (o: IGetAllOptions) => Promise<IOperationResult<R[]>>, map: (r: R) => T, cap = 5000): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const { data, skipToken } = await call(() => fetcher({ top: 500, skipToken: token }));
    out.push(...(data ?? []).map(map));
    token = skipToken;
  } while (token && out.length < cap);
  return out;
}

export interface SampleCounts {
  checkouts: number;
  equipment: number;
  users: number;
  settings: number;
}

export async function countSampleData(): Promise<SampleCounts> {
  const [co, eq, us] = await Promise.all([
    scanAll((o) => CheckoutsService.getAll(o), mapCheckout),
    scanAll((o) => EquipmentService.getAll(o), mapEquipment),
    scanAll((o) => AppUsersService.getAll(o), (r) => ({ id: r.ID ?? 0, dept: r.Department ?? "" })),
  ]);
  return {
    checkouts: co.filter((c) => c.notes.includes(SAMPLE_MARKER)).length,
    equipment: eq.filter((e) => e.notes.includes(SAMPLE_MARKER)).length,
    users: us.filter((u) => u.dept.includes(SAMPLE_MARKER)).length,
    settings: 0,
  };
}

/** Deletes only rows marked [SAMPLE]. Checkouts first so no orphaned lookups remain. */
export async function removeSampleData(onProgress?: (msg: string) => void): Promise<SampleCounts> {
  const done: SampleCounts = { checkouts: 0, equipment: 0, users: 0, settings: 0 };
  const co = (await scanAll((o) => CheckoutsService.getAll(o), mapCheckout)).filter((c) => c.notes.includes(SAMPLE_MARKER));
  for (const c of co) {
    await callVoid(() => CheckoutsService.delete(String(c.id)));
    done.checkouts++;
    onProgress?.(`Removed ${done.checkouts} of ${co.length} sample checkouts`);
  }
  const eq = (await scanAll((o) => EquipmentService.getAll(o), mapEquipment)).filter((e) => e.notes.includes(SAMPLE_MARKER));
  for (const e of eq) {
    if (await equipmentHasHistory(e.id)) continue; // real checkouts reference it — keep
    await callVoid(() => EquipmentService.delete(String(e.id)));
    done.equipment++;
    onProgress?.(`Removed ${done.equipment} of ${eq.length} sample items`);
  }
  const us = (await scanAll((o) => AppUsersService.getAll(o), mapAppUser)).filter((u) => u.department.includes(SAMPLE_MARKER) && u.role !== "IT Admin");
  for (const u of us) {
    await callVoid(() => AppUsersService.delete(String(u.id)));
    done.users++;
  }
  // AppSettings rows are configuration the app depends on; they are kept.
  return done;
}
