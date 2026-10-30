import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  Loader2Icon,
  RefreshCwIcon,
  WifiOffIcon,
  WrenchIcon,
  LaptopIcon,
  MonitorIcon,
  SmartphoneIcon,
  CableIcon,
  PackageIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DisplayStatus, PersonRef } from "@/lib/domain";
import { classifyError, searchPeople } from "@/lib/api";
import { useOnline } from "@/lib/app-data";

// ---------------------------------------------------------------- status
// Each status has its own label, icon AND shape, so color is never the only cue.
const STATUS_STYLE: Record<DisplayStatus, { icon: typeof CheckCircle2Icon; cls: string }> = {
  Available: {
    icon: CheckCircle2Icon,
    cls: "rounded-full border-2 border-[color:var(--link)] bg-transparent text-foreground",
  },
  "Checked out": {
    icon: ClockIcon,
    cls: "rounded-md border border-transparent bg-accent-fill text-accent-fill-foreground",
  },
  "In repair": {
    icon: WrenchIcon,
    cls: "rounded-md border-2 border-dashed border-foreground/70 bg-transparent text-foreground",
  },
  Retired: {
    icon: ArchiveIcon,
    cls: "rounded-sm border border-foreground/40 bg-muted text-foreground line-through decoration-1",
  },
  Overdue: {
    icon: AlertTriangleIcon,
    cls: "rounded-none border-2 border-overdue bg-overdue text-overdue-foreground font-bold uppercase tracking-wide [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)] px-3",
  },
};

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span className={cn("status-badge inline-flex min-h-6 items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.cls, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}

export const TYPE_ICON: Record<string, typeof LaptopIcon> = {
  Laptop: LaptopIcon,
  Monitor: MonitorIcon,
  Phone: SmartphoneIcon,
  Dock: CableIcon,
  Other: PackageIcon,
};

/** Photo placeholder: a drawn device silhouette per type. */
export function DevicePlaceholder({ type, tag }: { type: string; tag: string }) {
  const Icon = TYPE_ICON[type] ?? PackageIcon;
  return (
    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-t-[inherit] bg-gradient-to-br from-secondary to-muted" aria-hidden="true">
      <Icon className="size-14 text-foreground/70" strokeWidth={1.25} />
      <span className="absolute right-2 bottom-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{tag}</span>
    </div>
  );
}

// ---------------------------------------------------------------- form controls
export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
  required?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1 text-sm font-medium text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

const controlCls =
  "w-full min-w-0 min-h-11 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:border-2";

function scrollIntoViewOnFocus(e: React.FocusEvent<HTMLElement>) {
  const el = e.currentTarget;
  window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
}

export function TextInput({ invalid, describedBy, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; describedBy?: string }) {
  return <input {...p} aria-invalid={invalid || undefined} aria-describedby={describedBy} onFocus={scrollIntoViewOnFocus} className={cn(controlCls, className)} />;
}
export function TextArea({ invalid, describedBy, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; describedBy?: string }) {
  return <textarea {...p} aria-invalid={invalid || undefined} aria-describedby={describedBy} onFocus={scrollIntoViewOnFocus} className={cn(controlCls, "min-h-20 resize-y", className)} />;
}
export function SelectInput({ invalid, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative min-w-0">
      <select {...p} aria-invalid={invalid || undefined} className={cn(controlCls, "appearance-none pr-9", className)}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------- responsive dialog
/** Centered modal on tablet/desktop, full-screen sheet on phone, with a sticky action bar. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
          "sm:max-h-[min(90dvh,52rem)] sm:max-w-xl",
        )}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <DialogHeader className="pt-safe shrink-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="pr-8 text-lg">{title}</DialogTitle>
          {description ? <DialogDescription asChild><div className="text-sm text-muted-foreground">{description}</div></DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        <div className="pb-safe sticky bottom-0 shrink-0 border-t border-border bg-popover px-5 py-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:min-h-11">{actions}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- feedback
export function ErrorPanel({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const e = classifyError(error);
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-lg border-2 border-destructive/60 bg-card p-4", className)}>
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p className="font-medium">{e.message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" className="min-h-11" onClick={onRetry}>
          <RefreshCwIcon aria-hidden="true" /> Try again
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-overdue px-4 py-2 text-sm font-medium text-overdue-foreground">
      <WifiOffIcon className="size-4" aria-hidden="true" /> You're offline. Saving is paused until the connection returns.
    </div>
  );
}

export function SavingLabel({ busy, idle, saving }: { busy: boolean; idle: string; saving: string }) {
  return busy ? (
    <>
      <Loader2Icon className="animate-spin" aria-hidden="true" /> {saving}
    </>
  ) : (
    <>{idle}</>
  );
}

export function Truncate({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("block truncate", className)} title={text}>
      {text}
    </span>
  );
}

export function SectionTitle({ children, count, action }: { children: ReactNode; count?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        {children}
        {count !== undefined && <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">{count}</span>}
      </h1>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- people picker
export function PersonPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: PersonRef | null;
  onChange: (p: PersonRef | null) => void;
  invalid?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PersonRef[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const listId = useId();
  const seq = useRef(0);
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    setState("loading");
    const h = window.setTimeout(() => {
      searchPeople(t)
        .then((r) => n === seq.current && (setResults(r.slice(0, 8)), setState("idle")))
        .catch(() => n === seq.current && setState("error"));
    }, 300);
    return () => window.clearTimeout(h);
  }, [term]);
  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <UserIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <Truncate text={value.name} className="font-medium" />
            <Truncate text={value.email} className="text-xs text-muted-foreground" />
          </span>
        </span>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <TextInput id={id} type="search" autoComplete="off" placeholder="Search by name or email" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9" invalid={invalid} aria-controls={listId} />
      </div>
      <ul id={listId} className="flex flex-col gap-1" aria-live="polite">
        {state === "loading" && <li className="text-sm text-muted-foreground">Searching…</li>}
        {state === "error" && <li className="text-sm text-destructive">People search failed. Try again.</li>}
        {state === "idle" && term.trim().length >= 2 && results.length === 0 && <li className="text-sm text-muted-foreground">No people found.</li>}
        {results.map((p) => (
          <li key={p.email}>
            <button type="button" onClick={() => onChange(p)} className="flex min-h-11 w-full flex-col items-start rounded-md border border-border px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- pager
export function Pager({
  page,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  busy,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3 pt-2">
      <Button variant="outline" className="min-h-11" disabled={!hasPrev || busy} onClick={onPrev}>
        Previous page
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        Page {page}
      </span>
      <Button variant="outline" className="min-h-11" disabled={!hasNext || busy} onClick={onNext}>
        Next page
      </Button>
    </nav>
  );
}

export function usePagedTokens(resetKey: string) {
  const [state, setState] = useState<{ key: string; token?: string; prev: (string | undefined)[] }>({ key: resetKey, prev: [] });
  const cur = state.key === resetKey ? state : { key: resetKey, token: undefined, prev: [] };
  return {
    token: cur.token,
    page: cur.prev.length + 1,
    hasPrev: cur.prev.length > 0,
    next: (t: string) => setState({ key: resetKey, token: t, prev: [...cur.prev, cur.token] }),
    back: () => setState({ key: resetKey, token: cur.prev[cur.prev.length - 1], prev: cur.prev.slice(0, -1) }),
  };
}
