"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const MIN_LENGTH = 12;
// Server error codes that map 1:1 to a localized string under admin.security.
const KNOWN_ERRORS = ["tooShort", "sameAsOld", "wrongCurrent"];

function PasswordField({
  label,
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  autoComplete: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-display text-sm outline-none focus:border-brand-red"
      />
    </label>
  );
}

/**
 * Admin "change password" form. Verifies the current password server-side and
 * enforces a minimum length; the API returns stable error codes that we map to
 * localized messages here.
 */
export default function ChangePassword() {
  const t = useTranslations("admin.security");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const canSubmit =
    !busy && current.length > 0 && next.length >= MIN_LENGTH && confirm.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);

    if (next.length < MIN_LENGTH) {
      setError(t("tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("mismatch"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        const code = d.error ?? "";
        throw new Error(KNOWN_ERRORS.includes(code) ? t(code) : code || "Error");
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <PasswordField
        label={t("current")}
        value={current}
        autoComplete="current-password"
        onChange={(v) => {
          setCurrent(v);
          setDone(false);
        }}
      />
      <PasswordField
        label={t("new")}
        value={next}
        autoComplete="new-password"
        onChange={(v) => {
          setNext(v);
          setDone(false);
        }}
      />
      <PasswordField
        label={t("confirm")}
        value={confirm}
        autoComplete="new-password"
        onChange={(v) => {
          setConfirm(v);
          setDone(false);
        }}
      />

      {error && <p className="font-display text-sm text-brand-red">{error}</p>}
      {done && <p className="font-display text-sm text-[#2fd07a]">{t("success")}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-brand-red px-4 py-2 font-display text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? t("working") : t("submit")}
      </button>
    </form>
  );
}
