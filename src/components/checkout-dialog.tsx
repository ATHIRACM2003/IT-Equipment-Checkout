import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormDialog, SavingLabel, StatusBadge, TextArea, TextInput, ErrorPanel } from "@/components/kit";
import { AppError, checkoutItem, fetchActiveCheckouts } from "@/lib/api";
import { useOnline, useSession, useSettingsValue } from "@/lib/app-data";
import { LIMITS, addDays, cleanText, displayStatus, formatDate, isOverdue, isValidISODate, todayISO, type Equipment } from "@/lib/domain";

const DRAFT_KEY = "itec.checkoutDraft";
export interface CheckoutDraft {
  itemId: number;
  due: string;
  purpose: string;
  notes: string;
}
export function readDraft(): CheckoutDraft | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "null");
    return v && typeof v.itemId === "number" ? (v as CheckoutDraft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: CheckoutDraft | null) {
  try {
    if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function useMyActive() {
  const { data: session } = useSession();
  const email = session?.me?.email;
  return useQuery({
    queryKey: ["myActive", email],
    enabled: !!email,
    queryFn: () => fetchActiveCheckouts({ borrowerEmail: email! }),
  });
}

export function CheckoutDialog({ item, onClose }: { item: Equipment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const settings = useSettingsValue();
  const { data: session } = useSession();
  const mine = useMyActive();
  const today = todayISO();
  const maxDue = addDays(today, settings.maxLoanDays);
  const defaultDue = addDays(today, Math.min(7, settings.maxLoanDays));
  const maxActive = session?.appUser?.maxActive ?? settings.maxActiveCheckouts;

  const [due, setDue] = useState(defaultDue);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  // restore draft (refresh / back button / rotation)
  useEffect(() => {
    if (!item) return;
    const d = readDraft();
    if (d && d.itemId === item.id) {
      setDue(d.due);
      setPurpose(d.purpose);
      setNotes(d.notes);
    } else {
      setDue(defaultDue);
      setPurpose("");
      setNotes("");
    }
    setErrors({});
    setFailure(null);
  }, [item?.id]);

  useEffect(() => {
    if (item) writeDraft({ itemId: item.id, due, purpose, notes });
  }, [item, due, purpose, notes]);

  const activeCount = mine.data?.length ?? 0;
  const hasOverdue = (mine.data ?? []).some((c) => isOverdue(c.dueDate, today));
  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!session?.me) b.push("We couldn't identify your directory account, so checkouts are disabled. Ask an IT admin to add you to the user list.");
    if (mine.data && activeCount >= maxActive) b.push(`You already have ${activeCount} of ${maxActive} active checkouts. Return an item first.`);
    if (mine.data && settings.blockIfOverdue && hasOverdue) b.push("You have an overdue item. Return it before checking out anything new.");
    return b;
  }, [session?.me, mine.data, activeCount, maxActive, settings.blockIfOverdue, hasOverdue]);

  function close() {
    writeDraft(null);
    onClose();
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!due) e.due = "Choose a due date.";
    else if (!isValidISODate(due)) e.due = "Enter a valid date.";
    else if (due < today) e.due = "The due date can't be in the past.";
    else if (due > maxDue) e.due = `The due date can't be more than ${settings.maxLoanDays} days from today (${formatDate(maxDue)}).`;
    const p = cleanText(purpose);
    if (!p) e.purpose = "Purpose is required.";
    else if (p.length > LIMITS.purpose) e.purpose = `Keep the purpose under ${LIMITS.purpose} characters.`;
    if (cleanText(notes).length > LIMITS.notes) e.notes = `Keep notes under ${LIMITS.notes} characters.`;
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !item || !session?.me) return;
    const e = validate();
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length) {
      document.getElementById(`co-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await checkoutItem({
        equipmentId: item.id,
        borrower: session.me,
        dueDate: due,
        purpose: cleanText(purpose),
        notes: cleanText(notes),
        settings,
        maxActive,
      });
      toast.success(`${item.tag} is checked out to you until ${formatDate(due)}.`);
      writeDraft(null);
      onClose();
    } catch (err) {
      setFailure(err);
      if (err instanceof AppError && err.kind === "conflict") {
        void qc.invalidateQueries({ queryKey: ["equipment"] });
      }
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["myActive"] });
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      void qc.invalidateQueries({ queryKey: ["dash"] });
    }
  }

  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => !o && close()}
      title={item ? `Check out ${item.tag}` : "Check out"}
      busy={busy}
      actions={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="checkout-form" disabled={busy || !online || blockers.length > 0}>
            <SavingLabel busy={busy} idle="Confirm checkout" saving="Checking out…" />
          </Button>
        </>
      }
    >
      {item && (
        <form id="checkout-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">{item.tag}</span>
              <StatusBadge status={displayStatus(item)} />
            </div>
            <p className="font-medium break-words">{item.model || "Unnamed model"}</p>
            <p className="text-sm text-muted-foreground">
              {item.type} · Serial {item.serial || "—"} · {item.location?.value || "Unknown location"}
            </p>
          </div>
          <p className="text-sm" aria-live="polite">
            <strong>
              {mine.isPending ? "…" : activeCount} of {maxActive}
            </strong>{" "}
            active checkouts used
          </p>
          {blockers.map((b) => (
            <p key={b} role="alert" className="rounded-md border-2 border-overdue bg-card p-3 text-sm font-medium">
              {b}
            </p>
          ))}
          {!online && <p className="text-sm font-medium">You're offline. Reconnect to confirm.</p>}
          {failure ? <ErrorPanel error={failure} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Due date" htmlFor="co-due" error={errors.due} hint={`Up to ${settings.maxLoanDays} days, latest ${formatDate(maxDue)}`} required>
              <TextInput id="co-due" type="date" min={today} max={maxDue} value={due} onChange={(e) => setDue(e.target.value)} required invalid={!!errors.due} describedBy={errors.due ? "co-due-error" : "co-due-hint"} />
            </Field>
            <Field label="Purpose" htmlFor="co-purpose" error={errors.purpose} required>
              <TextInput id="co-purpose" value={purpose} maxLength={LIMITS.purpose} onChange={(e) => setPurpose(e.target.value)} required invalid={!!errors.purpose} describedBy={errors.purpose ? "co-purpose-error" : undefined} autoComplete="off" />
            </Field>
          </div>
          <Field label="Notes" htmlFor="co-notes" error={errors.notes}>
            <TextArea id="co-notes" value={notes} maxLength={LIMITS.notes} onChange={(e) => setNotes(e.target.value)} invalid={!!errors.notes} rows={3} />
          </Field>
        </form>
      )}
    </FormDialog>
  );
}
