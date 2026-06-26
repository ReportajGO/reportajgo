"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CATEGORIES, ASPECTS, ASPECT_CSS, type AspectRatio } from "@/lib/constants";
import { locales } from "@/i18n/routing";

export type PostFormData = {
  id?: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  language: string;
  imageUrl: string; // existing image URL (edit mode)
  breaking: boolean;
  published: boolean;
  aspect: string; // cover proportion: "16:9" | "1:1" | "4:5"
  gallery: string[]; // existing extra photo URLs (edit mode)
};

const empty: PostFormData = {
  title: "",
  excerpt: "",
  content: "",
  category: "world",
  language: "ru",
  imageUrl: "",
  breaking: false,
  published: true,
  aspect: "16:9",
  gallery: [],
};

// A gallery slot: either an existing saved URL or a freshly chosen File.
type GalleryItem = { key: string; url?: string; file?: File; preview: string };

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

const inputCls =
  "w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-display text-sm outline-none focus:border-brand-red";
const labelCls =
  "mb-1.5 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft";

export default function PostForm({ initial }: { initial?: PostFormData }) {
  const t = useTranslations("admin");
  const tNav = useTranslations("nav");
  const router = useRouter();

  const [form, setForm] = useState<PostFormData>(initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Image state: a newly chosen file, a preview URL, and whether the existing
  // image should be cleared on save.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.imageUrl || null);
  const [removeImage, setRemoveImage] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Gallery (extra photos): existing URLs become items up front.
  const [gallery, setGallery] = useState<GalleryItem[]>(
    () =>
      (initial?.gallery ?? []).map((url, i) => ({
        key: `init-${i}`,
        url,
        preview: url,
      })),
  );
  const galleryInput = useRef<HTMLInputElement>(null);
  const gallerySeq = useRef(0);

  const isEdit = Boolean(form.id);

  // Revoke object URLs to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function set<K extends keyof PostFormData>(key: K, value: PostFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function acceptFile(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError(t("upload.errType"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("upload.errSize"));
      return;
    }
    if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRemoveImage(false);
  }

  function clearImage() {
    if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setRemoveImage(true);
    if (fileInput.current) fileInput.current.value = "";
  }

  function addGalleryFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter(
      (f) => f.type.startsWith("image/") && f.size <= MAX_BYTES,
    );
    if (valid.length !== (files?.length ?? 0)) setError(t("upload.errSize"));
    setGallery((g) => [
      ...g,
      ...valid.map((file) => ({
        key: `new-${gallerySeq.current++}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
    if (galleryInput.current) galleryInput.current.value = "";
  }

  function removeGalleryItem(key: string) {
    setGallery((g) => {
      const item = g.find((x) => x.key === key);
      if (item?.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
      return g.filter((x) => x.key !== key);
    });
  }

  // Clean up gallery object URLs on unmount.
  useEffect(() => {
    return () => {
      gallery.forEach((it) => {
        if (it.preview.startsWith("blob:")) URL.revokeObjectURL(it.preview);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const fd = new FormData();
    fd.append("title", form.title);
    fd.append("excerpt", form.excerpt);
    fd.append("content", form.content);
    fd.append("category", form.category);
    fd.append("language", form.language);
    fd.append("breaking", String(form.breaking));
    fd.append("published", String(form.published));
    fd.append("aspect", form.aspect);
    if (file) fd.append("image", file);
    else if (removeImage) fd.append("removeImage", "true");

    // Gallery: keep existing URLs, upload newly added files.
    fd.append(
      "galleryUrls",
      JSON.stringify(gallery.filter((g) => g.url).map((g) => g.url)),
    );
    gallery.forEach((g) => {
      if (g.file) fd.append("gallery", g.file);
    });

    // No explicit Content-Type — the browser sets the multipart boundary.
    const res = await fetch(isEdit ? `/api/posts/${form.id}` : "/api/posts", {
      method: isEdit ? "PUT" : "POST",
      body: fd,
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div>
        <label className={labelCls}>{t("fields.headline")}</label>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          required
        />
      </div>

      <div>
        <label className={labelCls}>{t("fields.excerpt")}</label>
        <textarea
          className={`${inputCls} min-h-[70px] resize-y`}
          value={form.excerpt}
          onChange={(e) => set("excerpt", e.target.value)}
          required
        />
      </div>

      <div>
        <label className={labelCls}>{t("fields.body")}</label>
        <textarea
          className={`${inputCls} min-h-[220px] resize-y leading-relaxed`}
          value={form.content}
          onChange={(e) => set("content", e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{t("fields.category")}</label>
          <select
            className={inputCls}
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tNav(c)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>{t("fields.language")}</label>
          <select
            className={inputCls}
            value={form.language}
            onChange={(e) => set("language", e.target.value)}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Image uploader — drag & drop or click */}
      <div>
        <label className={labelCls}>{t("fields.image")}</label>

        {preview ? (
          <div className="relative overflow-hidden rounded-xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="preview"
              className="w-full object-cover"
              style={{ aspectRatio: ASPECT_CSS[form.aspect as AspectRatio] ?? "16 / 9" }}
            />
            <div className="absolute right-2 top-2 flex gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="rounded-full bg-black/55 px-3 py-1.5 font-display text-xs font-bold text-white backdrop-blur hover:bg-black/70"
              >
                {t("upload.change")}
              </button>
              <button
                type="button"
                onClick={clearImage}
                className="rounded-full bg-black/55 px-3 py-1.5 font-display text-xs font-bold text-white backdrop-blur hover:bg-brand-red"
              >
                {t("upload.remove")}
              </button>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && fileInput.current?.click()
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging
                ? "border-brand-red bg-brand-red/5"
                : "border-line bg-bg-sub hover:border-brand-red"
            }`}
          >
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="mb-3 text-brand-red"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            <p className="font-display text-sm font-bold text-ink">
              {t("upload.hint")}
            </p>
            <p className="mt-1 font-display text-xs text-ink-soft">
              {t("upload.hintSub")}
            </p>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
      </div>

      {/* Cover aspect ratio */}
      <div>
        <label className={labelCls}>{t("fields.aspect")}</label>
        <div className="flex gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => set("aspect", a)}
              className={`flex-1 rounded-lg border px-3 py-2.5 font-display text-sm font-bold transition-colors ${
                form.aspect === a
                  ? "border-brand-red bg-brand-red/10 text-brand-red"
                  : "border-line text-ink-soft hover:border-brand-red"
              }`}
            >
              {a === "16:9"
                ? t("aspect.wide")
                : a === "1:1"
                  ? t("aspect.square")
                  : t("aspect.portrait")}
              <span className="ml-1.5 opacity-60">{a}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Extra photos (gallery) */}
      <div>
        <label className={labelCls}>{t("fields.gallery")}</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {gallery.map((g) => (
            <div
              key={g.key}
              className="relative overflow-hidden rounded-lg border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.preview}
                alt="gallery item"
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                aria-label={t("upload.remove")}
                onClick={() => removeGalleryItem(g.key)}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-sm font-bold text-white hover:bg-brand-red"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-line text-3xl font-light text-ink-soft transition-colors hover:border-brand-red hover:text-brand-red"
          >
            +
          </button>
        </div>
        <input
          ref={galleryInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => addGalleryFiles(e.target.files)}
        />
        <p className="mt-1.5 font-display text-xs text-ink-soft">
          {t("fields.galleryHint")}
        </p>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 font-display text-sm">
          <input
            type="checkbox"
            checked={form.breaking}
            onChange={(e) => set("breaking", e.target.checked)}
            className="h-4 w-4 accent-brand-red"
          />
          {t("fields.breaking")}
        </label>
        <label className="flex items-center gap-2 font-display text-sm">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => set("published", e.target.checked)}
            className="h-4 w-4 accent-brand-red"
          />
          {t("fields.published")}
        </label>
      </div>

      {error && (
        <p className="rounded-lg bg-brand-red/10 px-3 py-2 font-display text-sm text-brand-red">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-red px-5 py-2.5 font-display text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving
            ? t("actions.saving")
            : isEdit
              ? t("actions.update")
              : t("actions.create")}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="rounded-lg border border-line px-5 py-2.5 font-display text-sm font-bold text-ink-soft hover:text-ink"
        >
          {t("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
