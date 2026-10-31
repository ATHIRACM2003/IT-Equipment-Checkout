// Equipment images. Each Equipment row keeps a reference in its PhotoPath column:
//  - "/EquipmentImages/..."  a file in the EquipmentImages library (the shared standard images)
//  - "photos:<ID>"           a photo uploaded from the app, stored as a compressed image (data URL
//                            text) in the EquipmentPhotos list. The app's SharePoint connection
//                            can only send text, so binary file uploads to the library are not used.
// Files are read and written only through the signed-in user's SharePoint connection;
// they are shown as in-memory data: URLs (never a public link).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EquipmentPhotosService, SharePointService } from "../../generated";
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
export const isStandardImage = (path: string | null | undefined): boolean =>
  !!path && Object.values(STANDARD_IMAGES).some((p) => p.toLowerCase() === path.toLowerCase());

export const PHOTO_PREFIX = "photos:";
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Stored photo size cap (characters of the data URL) so it fits a SharePoint text field. */
const MAX_DATA_CHARS = 60_000;
const photoId = (path: string): string | null => {
  const m = /^photos:(\d+)$/i.exec(path.trim());
  return m ? m[1] : null;
};
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
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export async function fetchImageDataUrl(path: string): Promise<string> {
  const id = photoId(path);
  if (id) {
    const p = await EquipmentPhotosService.get(id, { select: ["ID", "ImageData"] });
    if (!p.success || !p.data) {
      console.error("photo load failed", p.error);
      throw new AppError("missing", "Image unavailable");
    }
    const m = DATA_URL.exec((p.data.ImageData ?? "").trim());
    if (!m || sniffMime(base64ToBytes(m[2].slice(0, 64))) === null) throw new AppError("validation", "Not a supported image");
    return `data:${m[1]};base64,${m[2].replace(/\s/g, "")}`;
  }
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

/**
 * Validates by real file type (not extension), then resizes and compresses in the browser
 * (longest side 1280px or less) until the stored photo fits the text field.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new AppError("validation", "That file is too large. Choose an image under 20 MB.");
  const original = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(original);
  if (!mime) throw new AppError("validation", "Only JPG, PNG or WebP images are allowed.");

  let dims: { width: number; height: number };
  try {
    const probe = await createImageBitmap(new Blob([original], { type: mime }));
    dims = { width: probe.width, height: probe.height };
    probe.close();
  } catch {
    throw new AppError("validation", "This image couldn't be read. Try a different JPG, PNG or WebP file.");
  }

  const fits = (bytes: Uint8Array, m: ImageMime) => bytes.length <= MAX_UPLOAD_BYTES && bytesToDataUrl(bytes, m).length <= MAX_DATA_CHARS;
  if (fits(original, mime) && Math.max(dims.width, dims.height) <= MAX_SIDE) {
    return { bytes: original, mime, ext: EXT[mime], dataUrl: bytesToDataUrl(original, mime) };
  }
  if (typeof OffscreenCanvas === "undefined") {
    throw new AppError("validation", "This browser can't compress photos. Choose a smaller image (about 40 KB or less).");
  }
  // Resize with the browser's decoder (no drawing canvas) and re-encode through a bitmap renderer.
  for (const side of [MAX_SIDE, 960, 800, 640, 512, 400, 320]) {
    const scale = Math.min(1, side / Math.max(dims.width, dims.height));
    const w = Math.max(1, Math.round(dims.width * scale));
    const h = Math.max(1, Math.round(dims.height * scale));
    for (const quality of [0.82, 0.7, 0.58]) {
      try {
        const bmp = await createImageBitmap(new Blob([original], { type: mime }), { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        const surface = new OffscreenCanvas(w, h);
        const renderer = surface.getContext("bitmaprenderer");
        if (!renderer) {
          bmp.close();
          break;
        }
        renderer.transferFromImageBitmap(bmp);
        let blob = await surface.convertToBlob({ type: "image/webp", quality });
        if (blob.type !== "image/webp") blob = await surface.convertToBlob({ type: "image/jpeg", quality });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const m = sniffMime(bytes);
        if (m && fits(bytes, m)) return { bytes, mime: m, ext: EXT[m], dataUrl: bytesToDataUrl(bytes, m) };
      } catch {
        /* try the next size */
      }
    }
  }
  throw new AppError("validation", "This photo couldn't be compressed enough to save. Try a smaller or simpler image.");
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
  const id = photoId(path);
  if (id) {
    const p = await EquipmentPhotosService.get(id, { select: ["ID"] });
    if (p.success && p.data) return true;
    const e = p.error as { status?: number; message?: string } | undefined;
    const m = String(e?.message ?? "").toLowerCase();
    if (e?.status === 404 || m.includes("404") || m.includes("not found") || m.includes("does not exist")) return false;
    throw new AppError("unknown", "Image check failed");
  }
  const r = await SharePointService.GetFileMetadataByPath(SITE, path);
  if (r.success && r.data) return true;
  const err = r.error as { status?: number; message?: string } | undefined;
  const msg = String(err?.message ?? "").toLowerCase();
  if (err?.status === 404 || msg.includes("404") || msg.includes("not found") || msg.includes("does not exist")) return false;
  throw new AppError("unknown", "Image check failed");
}

/** Saves an uploaded photo in the EquipmentPhotos list and returns its PhotoPath reference. */
export async function uploadImage(img: PreparedImage, tag: string): Promise<string> {
  const name = safeFileName(tag, img.ext);
  const r = await EquipmentPhotosService.create({ Title: name, ImageData: img.dataUrl, AssetTag: tag });
  if (!r.success || !r.data?.ID) {
    console.error("photo upload failed", r.error);
    throw new AppError("unknown", "The photo couldn't be uploaded, so nothing was saved. Check your connection and try again.");
  }
  const ref = `${PHOTO_PREFIX}${r.data.ID}`;
  // Verify the stored text round-trips intact before the equipment row points at it.
  const check = await EquipmentPhotosService.get(String(r.data.ID), { select: ["ID", "ImageData"] });
  if (!check.success || (check.data?.ImageData ?? "").trim() !== img.dataUrl) {
    await EquipmentPhotosService.delete(String(r.data.ID)).catch(() => undefined);
    throw new AppError("unknown", "The photo didn't save correctly, so nothing was saved. Try a smaller image.");
  }
  return ref;
}

/** Deletes an uploaded image. Standard images are never deleted. */
export async function deleteImage(path: string): Promise<void> {
  if (isStandardImage(path)) return;
  const id = photoId(path);
  if (id) {
    await EquipmentPhotosService.delete(id);
    return;
  }
  const meta = await metadataByPath(path);
  if (!meta?.Id) return;
  const r = await SharePointService.DeleteFile(SITE, meta.Id);
  if (!r.success) {
    console.error("image delete failed", r.error);
    throw new AppError("unknown", "The old image couldn't be deleted. It can be removed later from the EquipmentImages library.");
  }
}
