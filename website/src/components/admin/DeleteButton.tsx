"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export default function DeleteButton({ id }: { id: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(t("actions.confirmDelete"))) return;
    setBusy(true);
    await fetch(`/api/posts/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="font-display text-xs font-bold text-brand-red hover:underline disabled:opacity-50"
    >
      {t("actions.delete")}
    </button>
  );
}
