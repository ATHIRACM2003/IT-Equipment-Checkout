import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorPanel, Field, FormDialog, SavingLabel, SelectInput, StatusBadge, TextArea, TextInput } from "@/components/kit";
import { checkUnique, createEquipment, equipmentHasHistory, fetchCheckoutsPage, updateEquipment } from "@/lib/api";
import { useChoices, useLocations, useOnline } from "@/lib/app-data";
import { LIMITS, TAG_PATTERN, TYPE_PREFIX, cleanText, formatDate, isOverdue, todayISO, type Equipment } from "@/lib/domain";
import { Pager, usePagedTokens, Truncate } from "@/components/kit";

interface Form {
  tag: string;
  type: string;
  model: string;
  serial: string;
  condition: string;
  location: string;
  notes: string;
}

const FORM_KEY = "itec.equipmentDraft";

export function EquipmentFormDialog({ open, item, onClose }: { open: boolean; item: Equipment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const types = useChoices("Type");
  const conditions = useChoices("Condition");
  const locations = useLocations();
  const [f, setF] = useState<Form>({ tag: "", type: "", model: "", serial: "", condition: "Good", location: "", notes: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const history = useQuery({
    queryKey: ["equipment", "hasHistory", item?.id],
    enabled: open && !!item,
    queryFn: () => equipmentHasHistory(item!.id),
  });
  const tagLocked = !!item && history.data === true;

  useEffect(() => {
    if (!open) return;
    let draft: (Form & { id: number | null }) | null = null;
    try {
      draft = JSON.parse(window.sessionStorage.getItem(FORM_KEY) ?? "null");
    } catch {
      draft = null;
    }
    if (draft && draft.id === (item?.id ?? null)) setF(draft);
    else if (item)
      setF({ tag: item.tag, type: item.type, model: item.model, serial: item.serial, condition: item.condition, location: item.location ? String(item.location.id) : "", notes: item.notes });
    else setF({ tag: "", type: "", model: "", serial: "", condition: "Good", location: "", notes: "" });
    setErrors({});
    setFailure(null);
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    try {
      window.sessionStorage.setItem(FORM_KEY, JSON.stringify({ ...f, id: item?.id ?? null }));
    } catch {
      /* ignore */
    }
  }, [f, open, item]);

  function close() {
    try {
      window.sessionStorage.removeItem(FORM_KEY);
    } catch {
      /* ignore */
    }
    onClose();
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const activeLocations = (locations.data ?? []).filter((l) => l.active);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const v = {
      tag: cleanText(f.tag).toUpperCase(),
      type: f.type,
      model: cleanText(f.model),
      serial: cleanText(f.serial),
      condition: f.condition,
      location: f.location,
      notes: cleanText(f.notes),
    };
    const e: Partial<Record<keyof Form, string>> = {};
    if (!v.tag) e.tag = "Asset tag is required.";
    else if (v.tag.length > LIMITS.tag) e.tag = `Keep the tag under ${LIMITS.tag} characters.`;
    else if (!TAG_PATTERN.test(v.tag)) e.tag = "Use the format XX-0000, for example LT-0001.";
    if (!v.type) e.type = "Choose a type.";
    if (!v.model) e.model = "Make and model are required.";
    else if (v.model.length > LIMITS.model) e.model = `Keep this under ${LIMITS.model} characters.`;
    if (!v.serial) e.serial = "Serial number is required.";
    else if (v.serial.length > LIMITS.serial) e.serial = `Keep this under ${LIMITS.serial} characters.`;
    if (!v.condition) e.condition = "Choose a condition.";
    const loc = activeLocations.find((l) => String(l.id) === v.location);
    if (!v.location) e.location = "Choose a location.";
    else if (!loc) e.location = "Choose an active location.";
    if (v.notes.length > LIMITS.notes) e.notes = `Keep notes under ${LIMITS.notes} characters.`;
    if (item && tagLocked && v.tag !== item.tag) e.tag = "The tag can't change because this item has checkout history.";
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length) {
      document.getElementById(`eq-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const dup = await checkUnique(v.tag, v.serial, item?.id);
      if (dup.tag || dup.serial) {
        setErrors({ tag: dup.tag, serial: dup.serial });
        document.getElementById(dup.tag ? "eq-tag" : "eq-serial")?.focus();
        return;
      }
      const input = { tag: v.tag, type: v.type, model: v.model, serial: v.serial, condition: v.condition, location: { id: loc!.id, value: loc!.name }, notes: v.notes };
      if (item) await updateEquipment(item.id, input);
      else await createEquipment(input);
      toast.success(item ? `${v.tag} updated.` : `${v.tag} added.`);
      close();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      void qc.invalidateQueries({ queryKey: ["dash"] });
    }
  }

  const currentLocInactive = item?.location && !activeLocations.some((l) => l.id === item.location!.id);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={item ? `Edit ${item.tag}` : "Add equipment"}
      busy={busy}
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="eq-form" disabled={busy || !online}>
            <SavingLabel busy={busy} idle={item ? "Save changes" : "Add equipment"} saving="Saving…" />
          </Button>
        </>
      }
    >
      <form id="eq-form" noValidate onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {failure ? <ErrorPanel error={failure} className="sm:col-span-2" /> : null}
        <Field label="Type" htmlFor="eq-type" error={errors.type ?? (types.isError ? "Types couldn't be loaded." : undefined)} required>
          <SelectInput
            id="eq-type"
            value={f.type}
            disabled={!types.isSuccess}
            invalid={!!errors.type}
            onChange={(e) => {
              const t = e.target.value;
              setF((p) => ({ ...p, type: t, tag: !item && (!p.tag || /^[A-Z]{2}-$/.test(p.tag)) ? `${TYPE_PREFIX[t] ?? "OT"}-` : p.tag }));
            }}
          >
            <option value="">Choose…</option>
            {types.data?.map((t) => <option key={t}>{t}</option>)}
          </SelectInput>
        </Field>
        <Field label="Asset tag" htmlFor="eq-tag" error={errors.tag} hint={tagLocked ? "Locked: this item has checkout history." : "Format XX-0000, e.g. LT-0001"} required>
          <TextInput id="eq-tag" value={f.tag} onChange={(e) => setF((p) => ({ ...p, tag: e.target.value.toUpperCase() }))} maxLength={LIMITS.tag} readOnly={tagLocked} invalid={!!errors.tag} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Make and model" htmlFor="eq-model" error={errors.model} required>
          <TextInput id="eq-model" value={f.model} onChange={set("model")} maxLength={LIMITS.model} invalid={!!errors.model} autoComplete="off" />
        </Field>
        <Field label="Serial number" htmlFor="eq-serial" error={errors.serial} required>
          <TextInput id="eq-serial" value={f.serial} onChange={set("serial")} maxLength={LIMITS.serial} invalid={!!errors.serial} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Condition" htmlFor="eq-condition" error={errors.condition ?? (conditions.isError ? "Conditions couldn't be loaded." : undefined)} required>
          <SelectInput id="eq-condition" value={f.condition} onChange={set("condition")} disabled={!conditions.isSuccess} invalid={!!errors.condition}>
            {conditions.data?.map((t) => <option key={t}>{t}</option>)}
          </SelectInput>
        </Field>
        <Field label="Location" htmlFor="eq-location" error={errors.location ?? (currentLocInactive ? "The current location is inactive or unknown — choose an active one." : undefined)} required>
          <SelectInput id="eq-location" value={f.location} onChange={set("location")} disabled={!locations.isSuccess} invalid={!!errors.location}>
            <option value="">Choose…</option>
            {activeLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="eq-notes" error={errors.notes}>
            <TextArea id="eq-notes" value={f.notes} onChange={set("notes")} maxLength={LIMITS.notes} rows={3} />
          </Field>
        </div>
      </form>
    </FormDialog>
  );
}

export function HistoryDialog({ item, onClose }: { item: Equipment | null; onClose: () => void }) {
  const pager = usePagedTokens(String(item?.id ?? ""));
  const q = useQuery({
    queryKey: ["checkouts", "history", item?.id, pager.token],
    enabled: !!item,
    queryFn: () => fetchCheckoutsPage({ equipmentId: item!.id }, 10, pager.token),
  });
  const today = todayISO();
  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={`History · ${item?.tag ?? ""}`}
      actions={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">Loading history…</p>
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 && !pager.hasPrev ? (
        <p className="text-sm text-muted-foreground">No checkouts yet.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {q.data.rows.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Truncate text={c.borrower?.name ?? "Unknown or deleted account"} className="font-medium" />
                  {c.state === "Active" ? <StatusBadge status={isOverdue(c.dueDate, today) ? "Overdue" : "Checked out"} /> : <span className="status-badge inline-flex min-h-6 items-center rounded-full border border-border px-2 text-xs">Returned</span>}
                </div>
                <p>
                  {formatDate(c.checkoutDate)} → due {formatDate(c.dueDate)}
                  {c.returnedDate && <> · returned {formatDate(c.returnedDate)}{c.returnedBy && !(c.borrower && c.returnedBy.email === c.borrower.email) ? ` by ${c.returnedBy.name}` : ""}</>}
                </p>
                {c.purpose && <p className="text-muted-foreground break-words">{c.purpose}</p>}
              </li>
            ))}
          </ol>
          <Pager page={pager.page} hasPrev={pager.hasPrev} hasNext={!!q.data.next} onPrev={pager.back} onNext={() => q.data.next && pager.next(q.data.next)} busy={q.isFetching} />
        </>
      )}
    </FormDialog>
  );
}
