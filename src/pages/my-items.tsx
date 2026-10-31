import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getEquipment } from "@/lib/api";
import { ItemImage } from "@/components/equipment-art";
import type { Equipment } from "@/lib/domain";
import { Link } from "react-router-dom";
import { PackageOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states";
import { ErrorPanel, SectionTitle, StatusBadge, Truncate } from "@/components/kit";
import { useMyActive } from "@/components/checkout-dialog";
import { ReturnDialog } from "@/components/return-dialog";
import { useOnline, useSession, useSettingsValue } from "@/lib/app-data";
import { formatDate, isOverdue, todayISO, type Checkout } from "@/lib/domain";

export function MyItemsPage() {
  const { data: session } = useSession();
  const settings = useSettingsValue();
  const online = useOnline();
  const q = useMyActive();
  const [returning, setReturning] = useState<Checkout | null>(null);
  const ids = (q.data ?? []).map((c) => c.equipment?.id).filter((x): x is number => !!x);
  const details = useQuery({
    queryKey: ["equipment", "mine", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const res = await Promise.allSettled(ids.map((id) => getEquipment(id)));
      const m = new Map<number, Equipment>();
      res.forEach((r) => r.status === "fulfilled" && m.set(r.value.id, r.value));
      return m;
    },
  });
  const photoOf = (c: Checkout) => (c.equipment ? details.data?.get(c.equipment.id)?.photoPath : undefined);
  const typeOf = (c: Checkout) => (c.equipment ? details.data?.get(c.equipment.id)?.type : undefined);
  const itemName = (c: Checkout) => {
    if (!c.equipment || c.equipmentMissing) return "Unknown item";
    const e = details.data?.get(c.equipment.id);
    return e ? `${e.type} · ${e.model}` : details.isPending ? "…" : "Unknown item";
  };
  const today = todayISO();
  const max = session?.appUser?.maxActive ?? settings.maxActiveCheckouts;
  const rows = [...(q.data ?? [])].sort((a, b) => {
    const ao = isOverdue(a.dueDate, today) ? 0 : 1;
    const bo = isOverdue(b.dueDate, today) ? 0 : 1;
    return ao - bo || (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        count={q.data ? `${q.data.length} of ${max} checkouts used` : undefined}
      >
        My items
      </SectionTitle>
      {!session?.me ? (
        <ErrorPanel error={new Error("403 We couldn't identify your directory account")} />
      ) : q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading your items">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageOpenIcon}
          title="You have no active checkouts"
          description="Borrow a laptop, monitor, phone or dock from the catalog."
          action={
            <Button asChild className="min-h-11">
              <Link to="/">Browse the catalog</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* phone: stacked cards */}
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((c) => {
              const od = isOverdue(c.dueDate, today);
              return (
                <li key={c.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2"><ItemImage thumb decorative type={typeOf(c)} photoPath={photoOf(c)} /><span className="font-mono font-semibold">{c.equipment?.value || "Unknown item"}</span></span>
                    <StatusBadge status={od ? "Overdue" : "Checked out"} />
                  </div>
                  <Truncate text={itemName(c)} className="text-sm font-medium" />
                  <Truncate text={c.purpose} className="text-sm text-muted-foreground" />
                  <p className="text-sm">
                    Due <strong>{formatDate(c.dueDate)}</strong> · since {formatDate(c.checkoutDate)}
                  </p>
                  <Button className="min-h-11 w-full" variant={od ? "default" : "outline"} disabled={!online} onClick={() => setReturning(c)}>
                    Return
                  </Button>
                </li>
              );
            })}
          </ul>
          {/* tablet / desktop: table */}
          <div className="hidden overflow-x-auto overflow-y-hidden rounded-2xl border bg-card surface-dense sm:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">My active checkouts, overdue first</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Tag</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Item</th>
                  <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">Checked out</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Due</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => {
                  const od = isOverdue(c.dueDate, today);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap"><span className="flex items-center gap-2"><ItemImage thumb decorative type={typeOf(c)} photoPath={photoOf(c)} />{c.equipment?.value || "Unknown item"}</span></td>
                      <td className="max-w-[18rem] px-4 py-3"><Truncate text={itemName(c)} className="font-medium" /><Truncate text={c.purpose || "—"} className="text-xs text-muted-foreground" /></td>
                      <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">{formatDate(c.checkoutDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.dueDate)}</td>
                      <td className="px-4 py-3"><StatusBadge status={od ? "Overdue" : "Checked out"} /></td>
                      <td className="px-4 py-3 text-right">
                        <Button className="min-h-11" variant={od ? "default" : "outline"} disabled={!online} onClick={() => setReturning(c)} aria-label={`Return ${c.equipment?.value ?? "item"}`}>
                          Return
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ReturnDialog checkout={returning} onClose={() => setReturning(null)} />
    </div>
  );
}
