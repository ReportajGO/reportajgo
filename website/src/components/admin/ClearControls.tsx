"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * Admin "Clear all content" + "Restore" controls.
 *
 * Strict: clearing requires typing CLEAR in a confirm dialog and the API rejects
 * anything else. Reversible: clearing only soft-deletes (sets clearedAt), and
 * Restore brings every cleared post back.
 */
export default function ClearControls({
  live,
  cleared,
}: {
  live: number;
  cleared: number;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canClear = confirmText.trim().toUpperCase() === "CLEAR";

  async function doClear() {
    if (!canClear) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/posts/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "CLEAR" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Error");
      }
      setOpen(false);
      setConfirmText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    if (!window.confirm(t("clear.restoreConfirm", { count: cleared }))) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/posts/restore", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Error");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-display text-xs text-ink-soft">
        {t("clear.liveLabel", { count: live })}
        {cleared > 0 ? ` · ${t("clear.clearedLabel", { count: cleared })}` : ""}
      </span>

      {cleared > 0 && (
        <button
          type="button"
          onClick={doRestore}
          disabled={busy}
          className="rounded-lg border border-line px-3 py-2 font-display text-sm font-bold text-ink-soft transition-colors hover:border-brand-red hover:text-ink disabled:opacity-50"
        >
          ↺ {t("clear.restore", { count: cleared })}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setError("");
          setConfirmText("");
          setOpen(true);
        }}
        disabled={busy || live === 0}
        className="rounded-lg border border-brand-red/40 px-3 py-2 font-display text-sm font-bold text-brand-red transition-colors hover:bg-brand-red hover:text-white disabled:opacity-40"
      >
        {t("clear.button")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 font-display text-lg font-extrabold text-ink">
              {t("clear.confirmTitle")}
            </h2>
            <p className="mb-4 font-display text-sm text-ink-soft">
              {t("clear.confirmBody", { count: live })}
            </p>
            <label className="mb-1.5 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
              {t("clear.confirmPrompt")}
            </label>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canClear && doClear()}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-sm outline-none focus:border-brand-red"
              placeholder="CLEAR"
            />
            {error && (
              <p className="mt-2 font-display text-sm text-brand-red">{error}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-line px-4 py-2 font-display text-sm font-bold text-ink-soft hover:text-ink disabled:opacity-50"
              >
                {t("clear.cancel")}
              </button>
              <button
                type="button"
                onClick={doClear}
                disabled={!canClear || busy}
                className="rounded-lg bg-brand-red px-4 py-2 font-display text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? t("clear.working") : t("clear.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
