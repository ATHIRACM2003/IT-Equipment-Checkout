import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorPanel, Field, FormDialog, SavingLabel, TextArea } from "@/components/kit";
import { returnCheckout } from "@/lib/api";
import { useOnline, useSession } from "@/lib/app-data";
import { LIMITS, cleanText, formatDate, samePerson, todayISO, type Checkout } from "@/lib/domain";

/** Confirm-and-return dialog. Employees can return only their own items; admins can return any. */
export function ReturnDialog({ checkout, onClose }: { checkout: Checkout | null; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const { data: session } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    setNote("");
    setFailure(null);
  }, [checkout?.id]);
  const admin = session?.role === "IT Admin";
  const own = !!checkout && samePerson(checkout.borrower, session?.me);
  const allowed = !!session?.me && (own || admin);

  async function confirm() {
    if (!checkout || !session?.me || busy || !allowed) return;
    setBusy(true);
    setFailure(null);
    try {
      await returnCheckout(checkout, session.me, admin && !own ? cleanText(note) : undefined);
      toast.success(`${checkout.equipment?.value ?? "Item"} returned.`);
      onClose();
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
      for (const k of ["myActive", "equipment", "dash", "checkouts", "integrity"]) void qc.invalidateQueries({ queryKey: [k] });
    }
  }

  return (
    <FormDialog
      open={!!checkout}
      onOpenChange={(o) => !o && onClose()}
      title={`Return ${checkout?.equipment?.value || "unknown item"}?`}
      busy={busy}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !online || !allowed}>
            <SavingLabel busy={busy} idle="Confirm return" saving="Returning…" />
          </Button>
        </>
      }
    >
      {checkout && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Borrower</dt>
            <dd className="min-w-0 break-words">{checkout.borrower?.name ?? "Unknown or deleted account"}</dd>
            <dt className="text-muted-foreground">Checked out</dt>
            <dd>{formatDate(checkout.checkoutDate)}</dd>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{formatDate(checkout.dueDate)}</dd>
            <dt className="text-muted-foreground">Return date</dt>
            <dd>{formatDate(todayISO())} (today)</dd>
          </dl>
          {!allowed && <p role="alert" className="text-sm font-medium text-destructive">You can only return items checked out to you.</p>}
          {admin && !own && (
            <Field label="Note (optional)" htmlFor="ret-note" hint="Saved on the checkout record with your name.">
              <TextArea id="ret-note" value={note} maxLength={LIMITS.notes} onChange={(e) => setNote(e.target.value)} rows={3} />
            </Field>
          )}
          {!online && <p className="text-sm font-medium">You're offline. Reconnect to confirm.</p>}
          {failure ? <ErrorPanel error={failure} /> : null}
        </div>
      )}
    </FormDialog>
  );
}
