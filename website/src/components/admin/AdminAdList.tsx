"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { adSlotDef } from "@/lib/adSlots";

export interface AdminAdRow {
  id: string;
  title: string;
  slot: string;
  imageUrl: string;
  linkUrl: string | null;
  published: boolean;
  order: number;
  startsAt: string | null; // ISO
  endsAt: string | null; // ISO
}

type Status = "live" | "hidden" | "scheduled" | "expired";

function statusOf(row: AdminAdRow): Status {
  if (!row.published) return "hidden";
  const now = Date.now();
  if (row.endsAt && new Date(row.endsAt).getTime() < now) return "expired";
  if (row.startsAt && new Date(row.startsAt).getTime() > now) return "scheduled";
  return "live";
}

const STATUS_CLS: Record<Status, string> = {
  live: "bg-green-500/15 text-green-600 dark:text-green-400",
  hidden: "bg-ink-soft/15 text-ink-soft",
  scheduled: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  expired: "bg-brand-red/15 text-brand-red",
};

export default function AdminAdList({ rows }: { rows: AdminAdRow[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(row: AdminAdRow) {
    setBusy(row.id);
    await fetch(`/api/ads/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !row.published }),
    });
    setBusy(null);
    router.refresh();
  }

  async function remove(row: AdminAdRow) {
    if (!confirm(t("actions.confirmDelete"))) return;
    setBusy(row.id);
    await fetch(`/api/ads/${row.id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  function fmt(iso: string | null): string | null {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows.map((row) => {
        const status = statusOf(row);
        const slotLabel = adSlotDef(row.slot)?.labelKey;
        const from = fmt(row.startsAt);
        const to = fmt(row.endsAt);
        return (
          <li key={row.id} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
            {/* Creative thumbnail */}
            <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-sub">
              <Image
                src={row.imageUrl}
                alt=""
                fill
                sizes="96px"
                className={`object-contain ${row.published ? "" : "opacity-50 grayscale"}`}
              />
            </div>

            {/* Content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start gap-1.5">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[status]}`}>
                  {t(`ads.status.${status}`)}
                </span>
                <span className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">
                  {row.title}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-xs text-ink-soft">
                <span>{slotLabel ? t(`ads.slots.${slotLabel}`) : row.slot}</span>
                {(from || to) && <span aria-hidden>·</span>}
                {(from || to) && (
                  <span>
                    {from ?? "…"} — {to ?? "∞"}
                  </span>
                )}
                {row.linkUrl && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="max-w-[140px] truncate text-brand-red">{row.linkUrl}</span>
                  </>
                )}
              </div>
              <div className="mt-auto flex items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={busy === row.id}
                  className="font-display text-xs font-bold text-ink-soft hover:text-ink disabled:opacity-50"
                >
                  {row.published ? t("ads.actions.unpublish") : t("ads.actions.publish")}
                </button>
                <Link
                  href={`/admin/ads/${row.id}/edit`}
                  className="font-display text-xs font-bold text-brand-red hover:underline"
                >
                  {t("actions.edit")}
                </Link>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={busy === row.id}
                  className="font-display text-xs font-bold text-brand-red hover:underline disabled:opacity-50"
                >
                  {t("actions.delete")}
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
