import { useState } from "react";
import { cn } from "@/lib/utils";
import { useImageUrl, useInView } from "@/lib/images";

/*
 * Flat, minimal equipment illustrations (inline SVG, bundled with the app).
 * One drawing per Equipment Type, all on the same 160x90 (16:9) canvas with the
 * same 3px rounded stroke, straight-on perspective and level of detail.
 * Colors come only from theme tokens (--art-*) so they adapt to light and dark mode.
 * No text, logos or brand shapes.
 */

const KNOWN = ["Laptop", "Monitor", "Phone", "Dock", "Other"] as const;
type ArtType = (typeof KNOWN)[number];

export function artTypeFor(type: string | null | undefined): ArtType {
  return (KNOWN as readonly string[]).includes(type ?? "") ? (type as ArtType) : "Other";
}

const LINE = { stroke: "var(--art-line)", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Shadow() {
  return <ellipse cx="80" cy="84" rx="54" ry="3.5" fill="var(--art-shadow)" />;
}

const DRAWINGS: Record<ArtType, React.ReactNode> = {
  Laptop: (
    <>
      <Shadow />
      <rect x="38" y="12" width="84" height="54" rx="5" fill="var(--art-body)" {...LINE} />
      <rect x="45" y="19" width="70" height="40" rx="2" fill="var(--art-screen)" />
      <path d="M45 50 L64 36 L76 45 L92 30 L115 48" fill="none" stroke="var(--art-detail)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 66 H134 L140 75 Q140 78 136 78 H24 Q20 78 20 75 Z" fill="var(--art-body)" {...LINE} />
      <path d="M70 70 H90" fill="none" {...LINE} strokeWidth={2.5} />
    </>
  ),
  Monitor: (
    <>
      <Shadow />
      <rect x="30" y="8" width="100" height="60" rx="5" fill="var(--art-body)" {...LINE} />
      <rect x="37" y="15" width="86" height="46" rx="2" fill="var(--art-screen)" />
      <path d="M37 52 L60 38 L74 47 L94 30 L123 50" fill="none" stroke="var(--art-detail)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M74 68 L72 78 H88 L86 68" fill="var(--art-body)" {...LINE} />
      <rect x="56" y="77" width="48" height="5" rx="2.5" fill="var(--art-body)" {...LINE} />
    </>
  ),
  Phone: (
    <>
      <Shadow />
      <rect x="61" y="6" width="38" height="76" rx="8" fill="var(--art-body)" {...LINE} />
      <rect x="66" y="16" width="28" height="56" rx="3" fill="var(--art-screen)" />
      <path d="M66 62 L74 54 L80 59 L87 50 L94 57" fill="none" stroke="var(--art-detail)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M76 11 H84" fill="none" {...LINE} strokeWidth={2.5} />
      <path d="M74 77 H86" fill="none" {...LINE} strokeWidth={2.5} />
    </>
  ),
  Dock: (
    <>
      <Shadow />
      <path d="M44 52 C30 52 30 72 16 72" fill="none" {...LINE} />
      <rect x="8" y="68" width="10" height="8" rx="3" fill="var(--art-body)" {...LINE} strokeWidth={2.5} />
      <rect x="44" y="32" width="96" height="40" rx="8" fill="var(--art-body)" {...LINE} />
      <rect x="44" y="32" width="96" height="9" rx="4" fill="var(--art-screen)" />
      <rect x="56" y="51" width="13" height="6" rx="3" fill="var(--art-detail)" />
      <rect x="76" y="50" width="14" height="8" rx="1.5" fill="var(--art-detail)" />
      <rect x="96" y="50" width="14" height="8" rx="1.5" fill="var(--art-detail)" />
      <circle cx="126" cy="54" r="3" fill="var(--art-line)" />
    </>
  ),
  Other: (
    <>
      <Shadow />
      <rect x="48" y="30" width="64" height="48" rx="4" fill="var(--art-body)" {...LINE} />
      <rect x="43" y="20" width="74" height="14" rx="3" fill="var(--art-screen)" {...LINE} />
      <path d="M80 20 V78" fill="none" stroke="var(--art-detail)" strokeWidth={6} />
      <path d="M58 46 H70 M58 54 H66" fill="none" {...LINE} strokeWidth={2.5} />
    </>
  ),
};

const LABEL: Record<ArtType, string> = {
  Laptop: "Laptop",
  Monitor: "Monitor",
  Phone: "Smartphone",
  Dock: "USB-C docking station",
  Other: "Other device",
};

export function EquipmentArt({
  type,
  decorative = false,
  className,
}: {
  type: string | null | undefined;
  /** True for thumbnails next to text that already names the item. */
  decorative?: boolean;
  className?: string;
}) {
  const t = artTypeFor(type);
  return (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid meet"
      className={cn("block h-full w-full", className)}
      {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": LABEL[t] })}
    >
      {DRAWINGS[t]}
    </svg>
  );
}

// ---------------------------------------------------------------- stored item images
/**
 * Shows the item's own image (from EquipmentImages via PhotoPath). Lazy-loads when near the
 * viewport, shows a skeleton while loading, and falls back to the type illustration when the
 * image is missing or fails. `src` lets a form preview a not-yet-saved image.
 */
export function ItemImage({
  type,
  tag,
  photoPath,
  src,
  decorative,
  className,
  thumb,
}: {
  type: string | null | undefined;
  tag?: string;
  photoPath?: string | null;
  src?: string | null;
  decorative?: boolean;
  className?: string;
  thumb?: boolean;
}) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const q = useImageUrl(src ? null : photoPath, seen);
  const [failed, setFailed] = useState(false);
  const url = src ?? q.data ?? null;
  const loading = !src && !!photoPath && (!seen || q.isPending) && !q.isError;
  const showFallback = !url || failed || q.isError;
  const alt = `${artTypeFor(type) === "Other" ? type || "Equipment" : type}${tag ? ` ${tag}` : ""}`;
  return (
    <div
      ref={ref}
      className={cn("art-frame relative flex items-center justify-center overflow-hidden", thumb ? "size-10 shrink-0 rounded-md" : "rounded-lg", className)}
      {...(decorative ? { "aria-hidden": true } : {})}
    >
      {loading ? (
        <div data-slot="skeleton" className="absolute inset-0 animate-pulse" />
      ) : showFallback ? (
        <EquipmentArt type={type} decorative={decorative} className={thumb ? "p-0.5" : "p-[6%]"} />
      ) : (
        <img src={url!} alt={decorative ? "" : alt} className="h-full w-full object-contain" decoding="async" onError={() => setFailed(true)} draggable={false} />
      )}
    </div>
  );
}
