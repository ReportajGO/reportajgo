"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const t = useTranslations("admin");
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState("admin@reportajgo.uz");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError(t("loginError"));
    } else {
      router.push("/admin");
      router.refresh();
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo size="lg" />
          <h1 className="font-display text-lg font-extrabold">
            {t("loginTitle")}
          </h1>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-line bg-surface p-6 shadow-card"
        >
          <label className="mb-1 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
            {t("email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mb-4 w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-display text-sm outline-none focus:border-brand-red"
          />

          <label className="mb-1 block font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
            {t("password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mb-4 w-full rounded-lg border border-line bg-bg px-3 py-2.5 font-display text-sm outline-none focus:border-brand-red"
          />

          {error && (
            <p className="mb-3 rounded-lg bg-brand-red/10 px-3 py-2 font-display text-sm text-brand-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-red py-2.5 font-display text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "…" : t("signIn")}
          </button>
        </form>

        <button
          onClick={() => router.push("/")}
          className="mx-auto mt-4 block font-display text-sm text-ink-soft hover:text-brand-red"
        >
          ← {t("backToSite")}
        </button>
      </div>
    </main>
  );
}
