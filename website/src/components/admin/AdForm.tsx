"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AD_SLOTS, AD_FORMAT_SIZE, adSlotDef } from "@/lib/adSlots";

export type AdFormData = {
  id?: string;
  title: string;
  slot: string;
  imageUrl: string; // existing creative URL (edit mode)
  linkUrl: string;
  published: boolean;
  order: number;
  startsAt: string; // datetime-local string ("" = none)
  endsAt: string; // datetime-local string ("" = none)
};

const empty: AdFormData = {
  title: "",
  slot: AD_SLOTS[0].id,
  imageUrl: "",
  linkUrl: "",
  published: true,
  order: 100,
  startsAt: "",
  endsAt: "",
};

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

const inputCls =
  "w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-display text-sm outline-none focus:border-brand-red";
const labelCls =
  "mb-1.5 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft";

export default function AdForm({ initial }: { initial?: AdFormData }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [form, setForm] = useState<AdFormData>(initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.imageUrl || null);
  const [removeImage, setRemoveImage] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(form.id);
  const format = adSlotDef(form.slot)?.format ?? "banner";

  useEffect(() => {
    return () => {
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function set<K extends keyof AdFormData>(key: K, value: AdFormData[K]) {
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // A creative is required — enforce before hitting the API.
    if (!file && (!preview || removeImage)) {
      setError(t("ads.imageRequired"));
      return;
    }

    setSaving(true);
    const fd = new FormData();
    fd.append("title", form.title);
    fd.append("slot", form.slot);
    fd.append("linkUrl", form.linkUrl);
    fd.append("published", String(form.published));
    fd.append("order", String(form.order));
    fd.append("startsAt", form.startsAt);
    fd.append("endsAt", form.endsAt);
    if (file) fd.append("image", file);
    else fd.append("imageUrl", form.imageUrl);

    const res = await fetch(isEdit ? `/api/ads/${form.id}` : "/api/ads", {
      method: isEdit ? "PUT" : "POST",
      body: fd,
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error");
      return;
    }
    router.push("/admin/ads");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div>
        <label className={labelCls}>{t("ads.fields.title")}</label>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("ads.fields.titleHint")}
          required
        />
      </div>

      <div>
        <label className={labelCls}>{t("ads.fields.slot")}</label>
        <select
          className={inputCls}
          value={form.slot}
          onChange={(e) => set("slot", e.target.value)}
        >
          {AD_SLOTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(`ads.slots.${s.labelKey}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Creative uploader — drag & drop or click. Box mirrors the live slot size. */}
      <div>
        <label className={labelCls}>{t("ads.fields.image")}</label>
        {preview ? (
          <div className="relative overflow-hidden rounded-xl border border-line bg-bg-sub">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="preview"
              className={`w-full object-contain ${AD_FORMAT_SIZE[format]}`}
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
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mb-3 text-brand-red">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            <p className="font-display text-sm font-bold text-ink">{t("upload.hint")}</p>
            <p className="mt-1 font-display text-xs text-ink-soft">{t("upload.hintSub")}</p>
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

      <div>
        <label className={labelCls}>{t("ads.fields.link")}</label>
        <input
          className={inputCls}
          type="url"
          inputMode="url"
          value={form.linkUrl}
          onChange={(e) => set("linkUrl", e.target.value)}
          placeholder="https://example.com"
        />
        <p className="mt-1.5 font-display text-xs text-ink-soft">{t("ads.fields.linkHint")}</p>
      </div>

      {/* Schedule (optional) */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{t("ads.fields.startsAt")}</label>
          <input
            className={inputCls}
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>{t("ads.fields.endsAt")}</label>
          <input
            className={inputCls}
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-3 font-display text-xs text-ink-soft">{t("ads.fields.scheduleHint")}</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{t("ads.fields.order")}</label>
          <input
            className={inputCls}
            type="number"
            value={form.order}
            onChange={(e) => set("order", Number.parseInt(e.target.value, 10) || 0)}
          />
          <p className="mt-1.5 font-display text-xs text-ink-soft">{t("ads.fields.orderHint")}</p>
        </div>
        <label className="flex items-center gap-2 self-end pb-2.5 font-display text-sm">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => set("published", e.target.checked)}
            className="h-4 w-4 accent-brand-red"
          />
          {t("ads.fields.published")}
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
          {saving ? t("actions.saving") : isEdit ? t("actions.update") : t("actions.create")}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/ads")}
          className="rounded-lg border border-line px-5 py-2.5 font-display text-sm font-bold text-ink-soft hover:text-ink"
        >
          {t("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
