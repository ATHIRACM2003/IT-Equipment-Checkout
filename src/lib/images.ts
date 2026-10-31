// Equipment images: each Equipment row keeps the site-relative path of its type's standard image
// (in the EquipmentImages library) in its PhotoPath column. Images are read through the signed-in
// user's SharePoint connection and shown as in-memory data: URLs (never a public link).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SharePointService } from "../../generated";
import { AppError } from "./api";

export const SITE = "https://sysforetech.sharepoint.com/sites/EquipmentCheckout";
export const LIBRARY = "/EquipmentImages";

/** The shared standard images, one per type. "Other" has none yet. */
export const STANDARD_IMAGES: Record<string, string> = {
  Laptop: `${LIBRARY}/standard/laptop.jpg`,
  Monitor: `${LIBRARY}/standard/monitor.jpg`,
  Phone: `${LIBRARY}/standard/phone.jpg`,
  Dock: `${LIBRARY}/standard/dock.jpg`,
};

export const standardImageFor = (type: string | null | undefined): string | null => STANDARD_IMAGES[type ?? ""] ?? null;


// ---------------------------------------------------------------- bytes helpers
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/** Detects the real image type from the file's first bytes (not its extension). */
export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalizes the connector's file-content payload into bytes. */
function payloadToBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") {
    const m = /^data:[^;,]*;base64,(.*)$/s.exec(data);
    return base64ToBytes(m ? m[1] : data);
  }
  if (data && typeof data === "object" && "$content" in data && typeof (data as { $content: unknown }).$content === "string") {
    return base64ToBytes((data as { $content: string }).$content);
  }
  throw new Error("Unsupported file content shape");
}

export function bytesToDataUrl(bytes: Uint8Array, mime: ImageMime): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

// ---------------------------------------------------------------- read
export async function fetchImageDataUrl(path: string): Promise<string> {
  const r = await SharePointService.GetFileContentByPath(SITE, path, true);
  if (!r.success) {
    console.error("image load failed", r.error);
    throw new AppError("missing", "Image unavailable");
  }
  const bytes = payloadToBytes(r.data);
  const mime = sniffMime(bytes);
  if (!mime) throw new AppError("validation", "Not a supported image");
  return bytesToDataUrl(bytes, mime);
}

/** Session-cached image as a data: URL. Only fetched once the element is near the viewport. */
export function useImageUrl(path: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["img", path?.toLowerCase()],
    enabled: enabled && !!path,
    queryFn: () => fetchImageDataUrl(path!),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

export function useInView<T extends Element>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [seen, rootMargin]);
  return { ref, seen };
}

// ---------------------------------------------------------------- existence check
/** True/false only when SharePoint answered; throws on throttling, network or permission errors. */
export async function imageExists(path: string): Promise<boolean> {
  const r = await SharePointService.GetFileMetadataByPath(SITE, path);
  if (r.success && r.data) return true;
  const err = r.error as { status?: number; message?: string } | undefined;
  const msg = String(err?.message ?? "").toLowerCase();
  if (err?.status === 404 || msg.includes("404") || msg.includes("not found") || msg.includes("does not exist")) return false;
  throw new AppError("unknown", "Image check failed");
}
