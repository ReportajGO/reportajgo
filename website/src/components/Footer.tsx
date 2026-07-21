import { useTranslations } from "next-intl";
import Logo from "./Logo";
import LangSwitcher from "./LangSwitcher";
import SocialLinks from "./SocialLinks";

export default function Footer() {
  const t = useTranslations();

  return (
    <footer className="mt-14 bg-ink py-12 text-bg">
      <div className="mx-auto max-w-page px-[22px]">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Logo size="md" invert />
            <p className="mt-2 font-display text-[11px] font-semibold uppercase tracking-[.12em] text-brand-red">
              {t("brand.slogan")}
            </p>
            <p className="mt-3 max-w-xs font-display text-[15px] opacity-70">
              {t("footer.tagline")}
            </p>
            <SocialLinks onDark className="mt-4" />
          </div>

          <div>
            <h4 className="mb-3 font-display text-[13px] font-extrabold uppercase tracking-[.08em] opacity-60">
              {t("footer.company")}
            </h4>
            {(["about", "editorial", "contact", "advertise"] as const).map((k) => (
              <span
                key={k}
                className="block cursor-pointer py-[5px] font-display text-sm opacity-85 hover:text-brand-red hover:opacity-100"
              >
                {t(`footer.${k}`)}
              </span>
            ))}
          </div>

          <div>
            <h4 className="mb-3 font-display text-[13px] font-extrabold uppercase tracking-[.08em] opacity-60">
              {t("footer.languages")}
            </h4>
            <LangSwitcher />
          </div>
        </div>

        <div className="mt-9 flex flex-wrap justify-between gap-3 border-t border-white/15 pt-4 font-mono text-xs opacity-60">
          <span>© 2026 ReportajGO · {t("footer.rights")}</span>
        </div>
      </div>
    </footer>
  );
}
