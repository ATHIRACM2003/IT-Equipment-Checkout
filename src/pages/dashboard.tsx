import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, PartyPopperIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/states";
import { ErrorPanel, SectionTitle, StatusBadge, Truncate } from "@/components/kit";
import { ReturnDialog } from "@/components/return-dialog";
import { fetchActiveCheckouts, scanEquipment } from "@/lib/api";
import { useOnline, useSession } from "@/lib/app-data";
import { daysBetween, formatDate, isOverdue, todayISO, type Checkout } from "@/lib/domain";
import { cn } from "@/lib/utils";

const chartConfig = { count: { label: "Checked out", color: "var(--chart-2)" } } satisfies ChartConfig;

function Tile({ label, value, icon: Icon, emphasis }: { label: string; value: number; icon: typeof ClockIcon; emphasis?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border p-4", emphasis && value > 0 ? "border-2 border-overdue bg-overdue text-overdue-foreground" : "border-border bg-card")}>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function DashboardPage() {
  const { data: session } = useSession();
  const online = useOnline();
  const admin = session?.role === "IT Admin";
  const [returning, setReturning] = useState<Checkout | null>(null);
  const q = useQuery({
    queryKey: ["dash"],
    queryFn: async () => {
      const [eq, active] = await Promise.all([scanEquipment(), fetchActiveCheckouts()]);
      return { ...eq, active };
    },
  });
  const today = todayISO();
  const stats = useMemo(() => {
    if (!q.data) return null;
    const rows = q.data.rows;
    const byType = new Map<string, number>();
    rows.filter((e) => e.status === "Checked out").forEach((e) => byType.set(e.type, (byType.get(e.type) ?? 0) + 1));
    const overdue = q.data.active.filter((c) => isOverdue(c.dueDate, today)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    return {
      available: rows.filter((e) => e.status === "Available").length,
      out: rows.filter((e) => e.status === "Checked out").length,
      repair: rows.filter((e) => e.status === "In repair").length,
      overdue,
      chart: ["Laptop", "Monitor", "Phone", "Dock", "Other"].map((t) => ({ type: t, count: byType.get(t) ?? 0 })).concat([...byType.entries()].filter(([t]) => !["Laptop", "Monitor", "Phone", "Dock", "Other"].includes(t)).map(([type, count]) => ({ type, count }))),
    };
  }, [q.data, today]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !stats) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;

  const total = stats.chart.reduce((s, r) => s + r.count, 0);
  const top = [...stats.chart].sort((a, b) => b.count - a.count)[0];

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle count={q.data.truncated ? "Counts cover the first 2,500 items" : undefined}>Dashboard</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Available" value={stats.available} icon={CheckCircle2Icon} />
        <Tile label="Checked out" value={stats.out} icon={ClockIcon} />
        <Tile label="In repair" value={stats.repair} icon={WrenchIcon} />
        <Tile label="Overdue" value={stats.overdue.length} icon={AlertTriangleIcon} emphasis />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section aria-labelledby="chart-title" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h2 id="chart-title" className="font-semibold">Checked out by type</h2>
          <p className="text-sm text-muted-foreground">{total === 0 ? "Nothing is checked out." : `${total} items out; most are ${top.type.toLowerCase()}s (${top.count}).`}</p>
          <div aria-hidden="true">
            <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
              <BarChart data={stats.chart} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="type" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="count" position="top" className="fill-foreground" fontSize={12} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Checked-out items by type</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1 font-medium">Type</th>
                <th scope="col" className="py-1 text-right font-medium">Checked out</th>
              </tr>
            </thead>
            <tbody>
              {stats.chart.map((r) => (
                <tr key={r.type}>
                  <td className="py-1">{r.type}</td>
                  <td className="py-1 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="overdue-title" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:col-span-3">
          <h2 id="overdue-title" className="font-semibold">Overdue <span className="text-sm font-normal text-muted-foreground">({stats.overdue.length})</span></h2>
          {stats.overdue.length === 0 ? (
            <EmptyState icon={PartyPopperIcon} title="Nothing is overdue" className="py-8" />
          ) : (
            <>
              <ul className="flex flex-col gap-2 sm:hidden">
                {stats.overdue.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{c.equipment?.value || "Unknown item"}</span>
                      <StatusBadge status="Overdue" />
                    </div>
                    <Truncate text={c.borrower?.name ?? "Unknown or deleted account"} className="text-sm" />
                    <p className="text-sm">Due {formatDate(c.dueDate)} · <strong>{daysBetween(c.dueDate!, today)} days late</strong></p>
                    {admin && <Button className="min-h-11" variant="outline" disabled={!online} onClick={() => setReturning(c)}>Return on behalf</Button>}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Overdue checkouts, oldest first</caption>
                  <thead className="border-b border-border">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-semibold">Tag</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Borrower</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">Due</th>
                      <th scope="col" className="hidden py-2 pr-3 font-semibold md:table-cell">Late</th>
                      {admin && <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.overdue.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">{c.equipment?.value || "Unknown item"}</td>
                        <td className="max-w-[14rem] py-2 pr-3"><Truncate text={c.borrower?.name ?? "Unknown or deleted account"} /></td>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDate(c.dueDate)}</td>
                        <td className="hidden py-2 pr-3 font-bold whitespace-nowrap md:table-cell">{daysBetween(c.dueDate!, today)} days</td>
                        {admin && (
                          <td className="py-2 text-right">
                            <Button className="min-h-11" variant="outline" disabled={!online} onClick={() => setReturning(c)}>Return</Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      <ReturnDialog checkout={returning} onClose={() => setReturning(null)} />
    </div>
  );
}
