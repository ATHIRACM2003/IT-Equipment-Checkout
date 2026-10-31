import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WrenchIcon,
  UsersIcon,
  MapPinIcon,
  PackageSearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/states";
import { useConfirm } from "@/hooks/use-confirm";
import { ErrorPanel, Field, FormDialog, Pager, PersonPicker, SavingLabel, SectionTitle, SelectInput, StatusBadge, TextInput, Truncate, usePagedTokens } from "@/components/kit";
import { EquipmentFormDialog, HistoryDialog } from "@/components/equipment-form";
import { ItemImage } from "@/components/equipment-art";
import { ReturnDialog } from "@/components/return-dialog";
import {
  countSampleData,
  deleteAppUser,
  deleteEquipment,
  deleteLocation,
  fetchCheckoutsPage,
  fetchEquipmentPage,
  removeSampleData,
  repairIssue,
  saveAppUser,
  saveLocation,
  scanIntegrity,
  setEquipmentStatus,
  type EquipmentFilter,
  type Issue,
} from "@/lib/api";
import { useAppUsers, useChoices, useLocations, useOnline, usePhone, useSession, useSettingsValue } from "@/lib/app-data";
import { LIMITS, cleanText, displayStatus, formatDate, isOverdue, todayISO, type AppUser, type Checkout, type Equipment, type Location, type PersonRef, type Role } from "@/lib/domain";

// ================================================================ inventory
function InventoryTab() {
  const phone = usePhone();
  const online = useOnline();
  const settings = useSettingsValue();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const types = useChoices("Type");
  const statuses = useChoices("Status");
  const locations = useLocations();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [loc, setLoc] = useState("");
  const [editing, setEditing] = useState<{ open: boolean; item: Equipment | null }>({ open: false, item: null });
  const [history, setHistory] = useState<Equipment | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  useEffect(() => {
    const h = window.setTimeout(() => setSearch(searchInput.trim().slice(0, 100)), 350);
    return () => window.clearTimeout(h);
  }, [searchInput]);
  const pageSize = phone ? Math.min(10, settings.pageSize) : settings.pageSize;
  const f: EquipmentFilter = { search: search || undefined, type: type || undefined, status: status || undefined, locationId: loc ? Number(loc) : undefined };
  const pager = usePagedTokens(JSON.stringify([f, pageSize]));
  const q = useQuery({ queryKey: ["equipment", "admin", f, pageSize, pager.token], queryFn: () => fetchEquipmentPage(f, pageSize, pager.token), placeholderData: keepPreviousData });

  async function changeStatus(e: Equipment, to: "Available" | "In repair" | "Retired") {
    if (busyId) return;
    if (e.status === "Checked out" && to !== "Available") {
      toast.error(`${e.tag} is checked out. Return it first.`);
      return;
    }
    const msg =
      to === "Retired"
        ? { title: `Retire ${e.tag}?`, description: "Retired items can't be checked out. You can bring it back later.", confirmLabel: "Retire", destructive: true }
        : to === "In repair"
          ? { title: `Send ${e.tag} to repair?`, description: "It can't be checked out while in repair.", confirmLabel: "Mark in repair" }
          : e.status === "Retired"
            ? { title: `Bring ${e.tag} back from retirement?`, description: "It becomes Available for checkout again.", confirmLabel: "Make available" }
            : { title: `Mark ${e.tag} available?`, confirmLabel: "Make available" };
    if (!(await confirm(msg))) return;
    setBusyId(e.id);
    try {
      await setEquipmentStatus(e.id, to);
      toast.success(`${e.tag} is now ${to}.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      void qc.invalidateQueries({ queryKey: ["dash"] });
    }
  }
  async function remove(e: Equipment) {
    if (!(await confirm({ title: `Delete ${e.tag}?`, description: "This can't be undone. Items with checkout history can only be retired.", confirmLabel: "Delete", destructive: true }))) return;
    setBusyId(e.id);
    try {
      await deleteEquipment(e.id);
      toast.success(`${e.tag} deleted.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: ["equipment"] });
    }
  }

  const actions = (e: Equipment) => (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" className="min-h-11" onClick={() => setEditing({ open: true, item: e })} aria-label={`Edit ${e.tag}`}>
        <PencilIcon aria-hidden="true" /> Edit
      </Button>
      <Button variant="outline" className="min-h-11" onClick={() => setHistory(e)} aria-label={`History for ${e.tag}`}>
        <HistoryIcon aria-hidden="true" /> History
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-h-11" disabled={busyId === e.id || !online} aria-label={`More actions for ${e.tag}`}>
            <MoreHorizontalIcon aria-hidden="true" /> More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {e.status !== "Available" && e.status !== "Checked out" && (
            <DropdownMenuItem className="min-h-11" onSelect={() => void changeStatus(e, "Available")}>
              <CheckCircle2Icon aria-hidden="true" /> Make available
            </DropdownMenuItem>
          )}
          {e.status !== "In repair" && (
            <DropdownMenuItem className="min-h-11" disabled={e.status === "Checked out"} onSelect={() => void changeStatus(e, "In repair")}>
              <WrenchIcon aria-hidden="true" /> Mark in repair{e.status === "Checked out" ? " (return first)" : ""}
            </DropdownMenuItem>
          )}
          {e.status !== "Retired" && (
            <DropdownMenuItem className="min-h-11" disabled={e.status === "Checked out"} onSelect={() => void changeStatus(e, "Retired")}>
              <ArchiveIcon aria-hidden="true" /> Retire{e.status === "Checked out" ? " (return first)" : ""}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => void remove(e)}>
            <Trash2Icon aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-end gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search" aria-label="Inventory filters">
        <Field label="Search" htmlFor="inv-search">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <TextInput id="inv-search" type="search" value={searchInput} maxLength={100} onChange={(e) => setSearchInput(e.target.value)} placeholder="Tag, model or serial" className="pl-9" />
          </div>
        </Field>
        <Field label="Type" htmlFor="inv-type">
          <SelectInput id="inv-type" value={type} onChange={(e) => setType(e.target.value)} disabled={!types.isSuccess}>
            <option value="">All types</option>
            {types.data?.map((t) => <option key={t}>{t}</option>)}
          </SelectInput>
        </Field>
        <Field label="Status" htmlFor="inv-status">
          <SelectInput id="inv-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!statuses.isSuccess}>
            <option value="">All statuses</option>
            {statuses.data?.map((t) => <option key={t}>{t}</option>)}
          </SelectInput>
        </Field>
        <Field label="Location" htmlFor="inv-loc">
          <SelectInput id="inv-loc" value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!locations.isSuccess}>
            <option value="">All locations</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Button className="min-h-11" onClick={() => setEditing({ open: true, item: null })} disabled={!online}>
          <PlusIcon aria-hidden="true" /> Add equipment
        </Button>
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading inventory">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 && !pager.hasPrev ? (
        <EmptyState icon={PackageSearchIcon} title={search || type || status || loc ? "No equipment matches" : "No equipment yet"} description={search || type || status || loc ? "Change the search or filters." : "Add the first item to start the catalog."} />
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {q.data.rows.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2"><ItemImage thumb decorative type={e.type} photoPath={e.photoPath} /><span className="font-mono font-semibold">{e.tag}</span></span>
                  <StatusBadge status={displayStatus(e)} />
                </div>
                <Truncate text={`${e.type} · ${e.model}`} className="text-sm font-medium" />
                <p className="text-sm text-muted-foreground">
                  {e.location && !e.locationMissing ? e.location.value : "Unknown location"} · {e.condition}
                  {e.status === "Checked out" && <> · due {formatDate(e.dueDate)}</>}
                </p>
                {actions(e)}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card surface-dense sm:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">All equipment</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className="px-3 py-3 font-semibold">Tag</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold lg:table-cell">Type</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Model</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold xl:table-cell">Serial</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold xl:table-cell">Condition</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold md:table-cell">Location</th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.rows.map((e) => (
                  <tr key={e.id} className={q.isFetching ? "opacity-70" : undefined}>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap"><span className="flex items-center gap-2"><ItemImage thumb decorative type={e.type} photoPath={e.photoPath} />{e.tag}</span></td>
                    <td className="hidden px-3 py-2 lg:table-cell">{e.type}</td>
                    <td className="max-w-[14rem] px-3 py-2"><Truncate text={e.model} /></td>
                    <td className="hidden max-w-[10rem] px-3 py-2 font-mono text-xs xl:table-cell"><Truncate text={e.serial} /></td>
                    <td className="px-3 py-2"><StatusBadge status={displayStatus(e)} /></td>
                    <td className="hidden px-3 py-2 xl:table-cell">{e.condition}</td>
                    <td className="hidden max-w-[10rem] px-3 py-2 md:table-cell">
                      {e.location && !e.locationMissing ? <Truncate text={e.location.value} /> : <span className="inline-flex items-center gap-1 font-medium"><ShieldAlertIcon className="size-3.5" aria-hidden="true" />Unknown location</span>}
                    </td>
                    <td className="px-3 py-2">{actions(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pager.page} hasPrev={pager.hasPrev} hasNext={!!q.data.next} onPrev={pager.back} onNext={() => q.data.next && pager.next(q.data.next)} busy={q.isFetching} />
        </>
      )}
      <EquipmentFormDialog open={editing.open} item={editing.item} onClose={() => setEditing({ open: false, item: null })} />
      <HistoryDialog item={history} onClose={() => setHistory(null)} />
    </div>
  );
}

// ================================================================ checkouts
function CheckoutsTab() {
  const settings = useSettingsValue();
  const online = useOnline();
  const [state, setState] = useState("Active");
  const [returning, setReturning] = useState<Checkout | null>(null);
  const pager = usePagedTokens(state);
  const q = useQuery({ queryKey: ["checkouts", "admin", state, pager.token], queryFn: () => fetchCheckoutsPage({ state: state || undefined }, settings.pageSize, pager.token), placeholderData: keepPreviousData });
  const today = todayISO();
  const badge = (c: Checkout) =>
    c.state === "Active" ? <StatusBadge status={isOverdue(c.dueDate, today) ? "Overdue" : "Checked out"} /> : <span className="status-badge inline-flex min-h-6 items-center gap-1 rounded-full border border-border px-2 text-xs"><CheckCircle2Icon className="size-3.5" aria-hidden="true" />Returned</span>;
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <Field label="State" htmlFor="co-state">
          <SelectInput id="co-state" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="Active">Active</option>
            <option value="Returned">Returned</option>
            <option value="">All</option>
          </SelectInput>
        </Field>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 && !pager.hasPrev ? (
        <EmptyState title={state === "Active" ? "No active checkouts" : "No checkouts"} />
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {q.data.rows.map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5 rounded-2xl border bg-card p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono font-semibold">{c.equipment?.value || "Unknown item"}</span>
                  {badge(c)}
                </div>
                <Truncate text={c.borrower?.name ?? "Unknown or deleted account"} />
                <p>Due {formatDate(c.dueDate)}{c.returnedDate && ` · returned ${formatDate(c.returnedDate)}`}</p>
                {c.state === "Active" && <Button className="min-h-11" variant="outline" disabled={!online} onClick={() => setReturning(c)}>Return on behalf</Button>}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card surface-dense sm:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Checkouts</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className="px-3 py-3 font-semibold">Tag</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Borrower</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold md:table-cell">Checked out</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Due</th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold lg:table-cell">Returned</th>
                  <th scope="col" className="px-3 py-3 font-semibold">State</th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{c.equipment?.value || "Unknown item"}</td>
                    <td className="max-w-[12rem] px-3 py-2"><Truncate text={c.borrower?.name ?? "Unknown or deleted account"} /></td>
                    <td className="hidden px-3 py-2 whitespace-nowrap md:table-cell">{formatDate(c.checkoutDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.dueDate)}</td>
                    <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">{c.returnedDate ? `${formatDate(c.returnedDate)}${c.returnedBy ? ` · ${c.returnedBy.name}` : ""}` : "—"}</td>
                    <td className="px-3 py-2">{badge(c)}</td>
                    <td className="px-3 py-2 text-right">{c.state === "Active" && <Button className="min-h-11" variant="outline" disabled={!online} onClick={() => setReturning(c)}>Return</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pager.page} hasPrev={pager.hasPrev} hasNext={!!q.data.next} onPrev={pager.back} onNext={() => q.data.next && pager.next(q.data.next)} busy={q.isFetching} />
        </>
      )}
      <ReturnDialog checkout={returning} onClose={() => setReturning(null)} />
    </div>
  );
}

// ================================================================ locations
function LocationsTab() {
  const q = useLocations();
  const qc = useQueryClient();
  const online = useOnline();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<{ open: boolean; loc: Location | null }>({ open: false, loc: null });
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    setName(edit.loc?.name ?? "");
    setActive(edit.loc?.active ?? true);
    setErr(undefined);
    setFailure(null);
  }, [edit]);
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const n = cleanText(name);
    if (!n) return setErr("Name is required.");
    if (n.length > LIMITS.location) return setErr(`Keep it under ${LIMITS.location} characters.`);
    if ((q.data ?? []).some((l) => l.id !== edit.loc?.id && l.name.toLowerCase() === n.toLowerCase())) return setErr("A location with this name already exists.");
    setBusy(true);
    try {
      await saveLocation(edit.loc?.id ?? null, n, active);
      toast.success("Location saved.");
      setEdit({ open: false, loc: null });
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["locations"] });
      void qc.invalidateQueries({ queryKey: ["equipment"] });
    }
  }
  async function remove(l: Location) {
    if (!(await confirm({ title: `Delete ${l.name}?`, description: "Locations used by equipment can't be deleted.", confirmLabel: "Delete", destructive: true }))) return;
    try {
      await deleteLocation(l.id);
      toast.success("Location deleted.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      void qc.invalidateQueries({ queryKey: ["locations"] });
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="min-h-11" onClick={() => setEdit({ open: true, loc: null })} disabled={!online}>
          <PlusIcon aria-hidden="true" /> Add location
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={MapPinIcon} title="No locations yet" description="Add a location before adding equipment." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <Truncate text={l.name} className="font-medium" />
                <span className="status-badge inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 text-xs">
                  {l.active ? <CheckCircle2Icon className="size-3.5" aria-hidden="true" /> : <ArchiveIcon className="size-3.5" aria-hidden="true" />}
                  {l.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="min-h-11 flex-1" onClick={() => setEdit({ open: true, loc: l })}>
                  <PencilIcon aria-hidden="true" /> Edit
                </Button>
                <Button variant="outline" className="min-h-11 flex-1" onClick={() => void remove(l)} disabled={!online}>
                  <Trash2Icon aria-hidden="true" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={edit.open}
        onOpenChange={(o) => !o && setEdit({ open: false, loc: null })}
        title={edit.loc ? "Edit location" : "Add location"}
        busy={busy}
        actions={
          <>
            <Button variant="outline" onClick={() => setEdit({ open: false, loc: null })} disabled={busy}>Cancel</Button>
            <Button type="submit" form="loc-form" disabled={busy || !online}><SavingLabel busy={busy} idle="Save" saving="Saving…" /></Button>
          </>
        }
      >
        <form id="loc-form" noValidate onSubmit={save} className="flex flex-col gap-4">
          {failure ? <ErrorPanel error={failure} /> : null}
          <Field label="Name" htmlFor="loc-name" error={err} required>
            <TextInput id="loc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.location} invalid={!!err} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (can be chosen for equipment)
          </label>
        </form>
      </FormDialog>
    </div>
  );
}

// ================================================================ users
function UsersTab() {
  const q = useAppUsers();
  const roles = useChoices("Role");
  const qc = useQueryClient();
  const online = useOnline();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const [edit, setEdit] = useState<{ open: boolean; u: AppUser | null }>({ open: false, u: null });
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [role, setRole] = useState<Role>("Employee");
  const [active, setActive] = useState(true);
  const [dept, setDept] = useState("");
  const [max, setMax] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const activeAdmins = (q.data ?? []).filter((a) => a.active && a.role === "IT Admin");
  useEffect(() => {
    setPerson(edit.u?.user ?? null);
    setRole(edit.u?.role ?? "Employee");
    setActive(edit.u?.active ?? true);
    setDept(edit.u?.department ?? "");
    setMax(edit.u?.maxActive ? String(edit.u.maxActive) : "");
    setErrors({});
    setFailure(null);
  }, [edit]);
  const isLastAdmin = (u: AppUser | null) => !!u && u.active && u.role === "IT Admin" && activeAdmins.length <= 1;

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const e: Record<string, string> = {};
    if (!person) e.person = "Choose a person.";
    else if ((q.data ?? []).some((a) => a.id !== edit.u?.id && a.user?.email.toLowerCase() === person.email.toLowerCase())) e.person = "This person is already in the list.";
    const m = max.trim();
    if (m && (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > 50)) e.max = "Enter a whole number from 1 to 50, or leave empty.";
    if (cleanText(dept).length > LIMITS.department) e.dept = `Keep it under ${LIMITS.department} characters.`;
    if (isLastAdmin(edit.u) && (!active || role !== "IT Admin")) e.role = "This is the last active IT Admin. Add another admin first.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await saveAppUser(edit.u?.id ?? null, { user: person!, role, active, department: cleanText(dept), maxActive: m ? Number(m) : null });
      toast.success("User saved.");
      setEdit({ open: false, u: null });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["appUsers"] });
    }
  }
  async function remove(u: AppUser) {
    if (isLastAdmin(u)) return toast.error("The last active IT Admin can't be removed.");
    if (!(await confirm({ title: `Remove ${u.name}?`, description: "They'll be treated as an Employee unless re-added.", confirmLabel: "Remove", destructive: true }))) return;
    try {
      await deleteAppUser(u.id);
      toast.success("User removed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      void qc.invalidateQueries({ queryKey: ["appUsers"] });
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="min-h-11" onClick={() => setEdit({ open: true, u: null })} disabled={!online}>
          <PlusIcon aria-hidden="true" /> Add user
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users listed" description="Everyone not listed is treated as an Employee." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Truncate text={u.user?.name ?? u.name} className="font-medium" />
                  <Truncate text={u.user?.email ?? "No account linked"} className="text-xs text-muted-foreground" />
                </div>
                <span className="status-badge inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs">
                  {u.role === "IT Admin" ? <ShieldCheckIcon className="size-3.5" aria-hidden="true" /> : <UsersIcon className="size-3.5" aria-hidden="true" />}
                  {u.role}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {u.active ? "Active" : "Inactive"}
                {u.department && ` · ${u.department}`}
                {u.maxActive && ` · max ${u.maxActive} checkouts`}
                {session?.appUser?.id === u.id && " · you"}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="min-h-11 flex-1" onClick={() => setEdit({ open: true, u })}>
                  <PencilIcon aria-hidden="true" /> Edit
                </Button>
                <Button variant="outline" className="min-h-11 flex-1" onClick={() => void remove(u)} disabled={!online || isLastAdmin(u)}>
                  <Trash2Icon aria-hidden="true" /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={edit.open}
        onOpenChange={(o) => !o && setEdit({ open: false, u: null })}
        title={edit.u ? "Edit user" : "Add user"}
        busy={busy}
        actions={
          <>
            <Button variant="outline" onClick={() => setEdit({ open: false, u: null })} disabled={busy}>Cancel</Button>
            <Button type="submit" form="user-form" disabled={busy || !online}><SavingLabel busy={busy} idle="Save" saving="Saving…" /></Button>
          </>
        }
      >
        <form id="user-form" noValidate onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {failure ? <ErrorPanel error={failure} className="sm:col-span-2" /> : null}
          <div className="sm:col-span-2">
            <Field label="Person" htmlFor="user-person" error={errors.person} required>
              <PersonPicker id="user-person" value={person} onChange={setPerson} invalid={!!errors.person} />
            </Field>
          </div>
          <Field label="Role" htmlFor="user-role" error={errors.role ?? (roles.isError ? "Roles couldn't be loaded." : undefined)} required>
            <SelectInput id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={!roles.isSuccess}>
              {roles.data?.map((r) => <option key={r}>{r}</option>)}
            </SelectInput>
          </Field>
          <Field label="Max active checkouts" htmlFor="user-max" error={errors.max} hint="Leave empty to use the app setting.">
            <TextInput id="user-max" type="number" inputMode="numeric" min={1} max={50} value={max} onChange={(e) => setMax(e.target.value)} invalid={!!errors.max} />
          </Field>
          <Field label="Department" htmlFor="user-dept" error={errors.dept}>
            <TextInput id="user-dept" value={dept} onChange={(e) => setDept(e.target.value)} maxLength={LIMITS.department} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end text-sm font-medium">
            <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isLastAdmin(edit.u)} />
            Active
          </label>
        </form>
      </FormDialog>
    </div>
  );
}

// ================================================================ data health
function HealthTab() {
  const locations = useLocations();
  const users = useAppUsers();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const online = useOnline();
  const { data: session } = useSession();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [returning, setReturning] = useState<Checkout | null>(null);
  const q = useQuery({
    queryKey: ["integrity", locations.dataUpdatedAt, users.dataUpdatedAt],
    enabled: locations.isSuccess && users.isSuccess,
    queryFn: () => scanIntegrity(locations.data!, users.data!),
  });
  const sample = useQuery({ queryKey: ["sampleCount"], queryFn: countSampleData });
  const [removing, setRemoving] = useState<string | null>(null);

  async function repair(i: Issue) {
    if (!session?.me) return;
    if (!(await confirm({ title: "Repair this record?", description: i.detail, confirmLabel: "Repair" }))) return;
    setBusyKey(i.key);
    try {
      await repairIssue(i, session.me);
      toast.success("Record repaired.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
      for (const k of ["integrity", "equipment", "dash", "checkouts", "myActive"]) void qc.invalidateQueries({ queryKey: [k] });
    }
  }
  async function removeSamples() {
    const c = sample.data;
    if (!c) return;
    const ok = await confirm({
      title: "Remove all sample data?",
      description: `Deletes only rows marked [SAMPLE]: ${c.checkouts} checkouts, ${c.equipment} equipment items and ${c.users} test users. Settings, locations and IT Admin rows are kept. This can't be undone.`,
      confirmLabel: "Remove sample data",
      destructive: true,
    });
    if (!ok) return;
    setRemoving("Starting…");
    try {
      const done = await removeSampleData(setRemoving);
      toast.success(`Removed ${done.checkouts} checkouts, ${done.equipment} items and ${done.users} users.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoving(null);
      for (const k of ["sampleCount", "integrity", "equipment", "dash", "checkouts", "myActive", "appUsers"]) void qc.invalidateQueries({ queryKey: [k] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ir-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ir-title" className="text-lg font-semibold">
            Inconsistent records {q.data && <span className="text-sm font-normal text-muted-foreground">({q.data.issues.length})</span>}
          </h2>
          <Button variant="outline" className="min-h-11" onClick={() => void q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? "Checking…" : "Check again"}
          </Button>
        </div>
        {q.data?.truncated && <p className="text-sm">Only the first 2,500 items were checked.</p>}
        {q.isPending ? (
          <Skeleton className="h-24" />
        ) : q.isError ? (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.issues.length === 0 ? (
          <EmptyState icon={CheckCircle2Icon} title="Everything is consistent" className="py-8" />
        ) : (
          <ul className="flex flex-col gap-2">
            {q.data.issues.map((i) => (
              <li key={i.key} className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-foreground/40 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-start gap-2 font-medium">
                    <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span className="break-words">{i.title}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{i.detail}</p>
                </div>
                {i.repairable ? (
                  <Button className="min-h-11 shrink-0" onClick={() => void repair(i)} disabled={busyKey === i.key || !online}>
                    <SavingLabel busy={busyKey === i.key} idle="Repair" saving="Repairing…" />
                  </Button>
                ) : i.kind === "inactive-borrower" && i.checkouts?.[0] ? (
                  <Button variant="outline" className="min-h-11 shrink-0" onClick={() => setReturning(i.checkouts![0])} disabled={!online}>
                    Force return
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sample-title" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <h2 id="sample-title" className="text-lg font-semibold">Sample data</h2>
        {sample.isPending ? (
          <Skeleton className="h-6 w-64" />
        ) : sample.isError ? (
          <ErrorPanel error={sample.error} onRetry={() => void sample.refetch()} />
        ) : (
          <p className="text-sm">
            {sample.data.checkouts} checkouts, {sample.data.equipment} equipment items and {sample.data.users} test users are marked [SAMPLE].
          </p>
        )}
        {removing && <p role="status" className="text-sm">{removing}</p>}
        <div>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={!online || !!removing || !sample.data || sample.data.checkouts + sample.data.equipment + sample.data.users === 0}
            onClick={() => void removeSamples()}
          >
            <Trash2Icon aria-hidden="true" /> Remove sample data
          </Button>
        </div>
      </section>
      <ReturnDialog checkout={returning} onClose={() => setReturning(null)} />
    </div>
  );
}

// ================================================================ page
export function AdminPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState("inventory");
  if (session?.role !== "IT Admin") {
    return <EmptyState icon={ShieldAlertIcon} title="Admins only" description="This area is for IT admins. Ask IT if you need access." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle>Admin</SectionTitle>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <TabsList className="h-auto w-max">
            {[
              ["inventory", "Inventory"],
              ["checkouts", "Checkouts"],
              ["locations", "Locations"],
              ["users", "Users"],
              ["health", "Data health"],
            ].map(([v, l]) => (
              <TabsTrigger key={v} value={v} className="min-h-11 px-4">
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="inventory"><InventoryTab /></TabsContent>
        <TabsContent value="checkouts"><CheckoutsTab /></TabsContent>
        <TabsContent value="locations"><LocationsTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="health"><HealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}
