import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterIcon, PackageSearchIcon, SearchIcon, XIcon, MapPinIcon, UserIcon, CalendarIcon, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/states";
import { DevicePlaceholder, ErrorPanel, Field, Pager, SectionTitle, SelectInput, StatusBadge, TextInput, Truncate, usePagedTokens } from "@/components/kit";
import { CheckoutDialog, readDraft } from "@/components/checkout-dialog";
import { fetchEquipmentPage, getEquipment, type EquipmentFilter } from "@/lib/api";
import { useChoices, useLocations, useOnline, usePhone, useSettingsValue } from "@/lib/app-data";
import { displayStatus, formatDate, type Equipment } from "@/lib/domain";

interface Filters {
  type: string;
  status: string;
  location: string;
}
const EMPTY: Filters = { type: "", status: "", location: "" };

function FilterFields({ value, onChange, idPrefix }: { value: Filters; onChange: (f: Filters) => void; idPrefix: string }) {
  const types = useChoices("Type");
  const statuses = useChoices("Status");
  const locations = useLocations();
  return (
    <>
      <Field label="Type" htmlFor={`${idPrefix}-type`} error={types.isError ? "Types couldn't be loaded." : undefined}>
        <SelectInput id={`${idPrefix}-type`} value={value.type} disabled={!types.isSuccess} onChange={(e) => onChange({ ...value, type: e.target.value })}>
          <option value="">All types</option>
          {types.data?.map((t) => <option key={t}>{t}</option>)}
        </SelectInput>
      </Field>
      <Field label="Status" htmlFor={`${idPrefix}-status`} error={statuses.isError ? "Statuses couldn't be loaded." : undefined}>
        <SelectInput id={`${idPrefix}-status`} value={value.status} disabled={!statuses.isSuccess} onChange={(e) => onChange({ ...value, status: e.target.value })}>
          <option value="">All statuses</option>
          {statuses.data?.map((t) => <option key={t}>{t}</option>)}
        </SelectInput>
      </Field>
      <Field label="Location" htmlFor={`${idPrefix}-loc`} error={locations.isError ? "Locations couldn't be loaded." : undefined}>
        <SelectInput id={`${idPrefix}-loc`} value={value.location} disabled={!locations.isSuccess} onChange={(e) => onChange({ ...value, location: e.target.value })}>
          <option value="">All locations</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.active ? "" : " (inactive)"}
            </option>
          ))}
        </SelectInput>
      </Field>
    </>
  );
}

function EquipmentCard({ item, onCheckout, canCheckout }: { item: Equipment; onCheckout: () => void; canCheckout: boolean }) {
  const status = displayStatus(item);
  return (
    <li className="lift flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card">
      <DevicePlaceholder type={item.type} tag={item.tag} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-mono text-base font-semibold">{item.tag}</h2>
          <StatusBadge status={status} />
        </div>
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">{item.type} · </span>
          <span className="font-medium break-words">{item.model || "—"}</span>
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {item.location && !item.locationMissing ? <Truncate text={item.location.value} /> : <span className="font-medium text-foreground">Unknown location</span>}
        </p>
        {item.status === "Checked out" && (
          <div className="flex flex-col gap-1 rounded-md bg-muted p-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <Truncate text={item.holder?.name ?? "Unknown holder"} />
            </span>
            <span className="flex items-center gap-1.5">
              {status === "Overdue" ? <AlertTriangleIcon className="size-3.5" aria-hidden="true" /> : <CalendarIcon className="size-3.5" aria-hidden="true" />}
              <span className={status === "Overdue" ? "font-bold" : undefined}>Due {formatDate(item.dueDate)}</span>
            </span>
          </div>
        )}
        <div className="mt-auto pt-2">
          {item.status === "Available" && (
            <Button className="min-h-11 w-full" onClick={onCheckout} disabled={!canCheckout} aria-label={`Check out ${item.tag}`}>
              Check out
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function HomePage() {
  const phone = usePhone();
  const online = useOnline();
  const settings = useSettingsValue();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDraft, setSheetDraft] = useState<Filters>(EMPTY);
  const [checkoutItem, setCheckoutItem] = useState<Equipment | null>(null);

  useEffect(() => {
    const h = window.setTimeout(() => setSearch(searchInput.trim().slice(0, 100)), 350);
    return () => window.clearTimeout(h);
  }, [searchInput]);

  // Reopen an in-progress checkout after refresh / back navigation.
  useEffect(() => {
    const d = readDraft();
    if (!d) return;
    getEquipment(d.itemId)
      .then((e) => e.status === "Available" && setCheckoutItem(e))
      .catch(() => undefined);
  }, []);

  const pageSize = phone ? Math.min(12, settings.pageSize) : settings.pageSize;
  const f: EquipmentFilter = {
    search: search || undefined,
    type: filters.type || undefined,
    status: filters.status || undefined,
    locationId: filters.location ? Number(filters.location) : undefined,
  };
  const pager = usePagedTokens(JSON.stringify([f, pageSize]));
  const q = useQuery({
    queryKey: ["equipment", "catalog", f, pageSize, pager.token],
    queryFn: () => fetchEquipmentPage(f, pageSize, pager.token),
    placeholderData: keepPreviousData,
  });
  const activeCount = [filters.type, filters.status, filters.location].filter(Boolean).length;
  const anyFilter = activeCount > 0 || !!search;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle>Equipment catalog</SectionTitle>
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:p-4" role="search" aria-label="Catalog filters">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="cat-search" className="sr-only">
              Search equipment
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <TextInput id="cat-search" type="search" placeholder="Search tag, model or serial" value={searchInput} maxLength={100} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" enterKeyHint="search" />
            </div>
          </div>
          {phone && (
            <Button
              variant="outline"
              className="min-h-11 shrink-0"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => {
                setSheetDraft(filters);
                setSheetOpen(true);
              }}
            >
              <FilterIcon aria-hidden="true" /> Filters
              {activeCount > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeCount}<span className="sr-only"> active</span></span>}
            </Button>
          )}
        </div>
        {!phone && (
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <FilterFields value={filters} onChange={setFilters} idPrefix="cat" />
            <Button variant="ghost" className="min-h-11" disabled={!activeCount} onClick={() => setFilters(EMPTY)}>
              <XIcon aria-hidden="true" /> Clear filters{activeCount > 0 ? ` (${activeCount})` : ""}
            </Button>
          </div>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>{[sheetDraft.type, sheetDraft.status, sheetDraft.location].filter(Boolean).length} active</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <FilterFields value={sheetDraft} onChange={setSheetDraft} idPrefix="sheet" />
          </div>
          <SheetFooter className="sticky bottom-0 flex-row gap-2 bg-background">
            <Button variant="outline" className="min-h-11 flex-1" onClick={() => setSheetDraft(EMPTY)}>
              Clear
            </Button>
            <Button
              className="min-h-11 flex-1"
              onClick={() => {
                setFilters(sheetDraft);
                setSheetOpen(false);
              }}
            >
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {q.isPending ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading equipment">
          {Array.from({ length: phone ? 3 : 8 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-72 rounded-xl" />
            </li>
          ))}
        </ul>
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 && !pager.hasPrev ? (
        anyFilter ? (
          <EmptyState
            icon={PackageSearchIcon}
            title="No equipment matches"
            description="Try a different search or clear the filters."
            action={
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setFilters(EMPTY);
                  setSearchInput("");
                }}
              >
                Clear search and filters
              </Button>
            }
          />
        ) : (
          <EmptyState icon={PackageSearchIcon} title="No equipment yet" description="Once IT adds equipment in Admin, it shows up here." />
        )
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {q.data.rows.length} items on this page
          </p>
          <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${q.isFetching ? "opacity-70" : ""}`}>
            {q.data.rows.map((item) => (
              <EquipmentCard key={item.id} item={item} canCheckout={online} onCheckout={() => setCheckoutItem(item)} />
            ))}
          </ul>
          {q.data.rows.length === 0 && <p className="text-center text-sm text-muted-foreground">No more matching items on this page.</p>}
          <Pager page={pager.page} hasPrev={pager.hasPrev} hasNext={!!q.data.next} onPrev={pager.back} onNext={() => q.data.next && pager.next(q.data.next)} busy={q.isFetching} />
        </>
      )}
      <CheckoutDialog item={checkoutItem} onClose={() => setCheckoutItem(null)} />
    </div>
  );
}
