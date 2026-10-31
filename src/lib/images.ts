// Equipment images stored in the SharePoint document library "EquipmentImages".
// Each Equipment row keeps the file's site-relative path in its PhotoPath column.
// Files are read and written only through the signed-in user's SharePoint connection;
// they are shown as in-memory data: URLs (never a public link).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SharePointService } from "../../generated";
import { AppError } from "./api";

export const SITE = "https://sysforetech.sharepoint.com/sites/EquipmentCheckout";
export const LIBRARY = "/EquipmentImages";
export const ITEMS_FOLDER = `${LIBRARY}/items`;

/** The shared standard images, one per type. "Other" has none yet. */
export const STANDARD_IMAGES: Record<string, string> = {
  Laptop: `${LIBRARY}/standard/laptop.jpg`,
  Monitor: `${LIBRARY}/standard/monitor.jpg`,
  Phone: `${LIBRARY}/standard/phone.jpg`,
  Dock: `${LIBRARY}/standard/dock.jpg`,
};

export const standardImageFor = (type: string | null | undefined): string | null => STANDARD_IMAGES[type ?? ""] ?? null;
export const isStandardImage = (path: string | null | undefined): boolean =>
  !!path && Object.values(STANDARD_IMAGES).some((p) => p.toLowerCase() === path.toLowerCase());

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1280;

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

// ---------------------------------------------------------------- prepare (validate + resize)
export interface PreparedImage {
  bytes: Uint8Array;
  mime: ImageMime;
  ext: "jpg" | "png" | "webp";
  dataUrl: string;
}
const EXT: Record<ImageMime, PreparedImage["ext"]> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Validates by real file type, resizes to <=1280px longest side, and enforces the 2 MB limit. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new AppError("validation", "That file is too large. Choose an image under 20 MB.");
  const original = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(original);
  if (!mime) throw new AppError("validation", "Only JPG, PNG or WebP images are allowed.");

  let out: { bytes: Uint8Array; mime: ImageMime } = { bytes: original, mime };
  let dims: { width: number; height: number };
  try {
    const probe = await createImageBitmap(new Blob([original], { type: mime }));
    dims = { width: probe.width, height: probe.height };
    probe.close();
  } catch {
    throw new AppError("validation", "This image couldn't be read. Try a different JPG, PNG or WebP file.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(dims.width, dims.height));
  if (scale < 1 || original.length > MAX_UPLOAD_BYTES) {
    // Resize with the browser's image decoder (no drawing canvas); re-encode via a bitmap renderer.
    try {
      const w = Math.max(1, Math.round(dims.width * scale));
      const h = Math.max(1, Math.round(dims.height * scale));
      const resized = await createImageBitmap(new Blob([original], { type: mime }), { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      if (typeof OffscreenCanvas !== "undefined") {
        const surface = new OffscreenCanvas(w, h);
        const renderer = surface.getContext("bitmaprenderer");
        if (renderer) {
          renderer.transferFromImageBitmap(resized);
          const targetType: ImageMime = mime === "image/png" ? "image/png" : "image/jpeg";
          let blob = await surface.convertToBlob({ type: targetType, quality: 0.85 });
          if (blob.size > MAX_UPLOAD_BYTES && targetType === "image/png") blob = await surface.convertToBlob({ type: "image/jpeg", quality: 0.85 });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const m = sniffMime(bytes);
          if (m) out = { bytes, mime: m };
        }
      } else resized.close();
    } catch {
      /* resizing unsupported in this browser: the original is used if it fits the limit */
    }
  }
  if (out.bytes.length > MAX_UPLOAD_BYTES) throw new AppError("validation", "The image is larger than 2 MB even after resizing. Choose a smaller image.");
  return { ...out, ext: EXT[out.mime], dataUrl: bytesToDataUrl(out.bytes, out.mime) };
}

// ---------------------------------------------------------------- write
export function safeFileName(tag: string, ext: string): string {
  const base = tag.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) || "ITEM";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${base}-${stamp}-${rand}.${ext}`;
}

async function metadataByPath(path: string) {
  const r = await SharePointService.GetFileMetadataByPath(SITE, path);
  if (!r.success || !r.data) return null;
  return r.data;
}

/** True/false only when SharePoint answered; throws on throttling, network or permission errors. */
export async function imageExists(path: string): Promise<boolean> {
  const r = await SharePointService.GetFileMetadataByPath(SITE, path);
  if (r.success && r.data) return true;
  const err = r.error as { status?: number; message?: string } | undefined;
  const msg = String(err?.message ?? "").toLowerCase();
  if (err?.status === 404 || msg.includes("404") || msg.includes("not found") || msg.includes("does not exist")) return false;
  throw new AppError("unknown", "Image check failed");
}

/**
 * Uploads an image into EquipmentImages/items and verifies the stored size matches the
 * bytes sent. Anything else is removed again and reported as a failed upload.
 */
export async function uploadImage(img: PreparedImage, tag: string): Promise<string> {
  const name = safeFileName(tag, img.ext);
  let binary = "";
  for (let i = 0; i < img.bytes.length; i += 0x8000) binary += String.fromCharCode(...img.bytes.subarray(i, i + 0x8000));
  const r = await SharePointService.CreateFile(SITE, ITEMS_FOLDER, name, binary);
  if (!r.success) {
    console.error("image upload failed", r.error);
    throw new AppError("unknown", "The image couldn't be uploaded, so nothing was saved. Try again, or use the standard image.");
  }
  const path = `${ITEMS_FOLDER}/${name}`;
  const meta = await metadataByPath(path);
  if (!meta || meta.Size !== img.bytes.length) {
    if (meta?.Id) await SharePointService.DeleteFile(SITE, meta.Id).catch(() => undefined);
    throw new AppError("unknown", "The image didn't upload correctly, so nothing was saved. Use the standard image for now.");
  }
  return path;
}

/** Deletes an uploaded image. Standard images are never deleted. */
export async function deleteImage(path: string): Promise<void> {
  if (isStandardImage(path)) return;
  const meta = await metadataByPath(path);
  if (!meta?.Id) return;
  const r = await SharePointService.DeleteFile(SITE, meta.Id);
  if (!r.success) {
    console.error("image delete failed", r.error);
    throw new AppError("unknown", "The old image couldn't be deleted. It can be removed later from the EquipmentImages library.");
  }
}
