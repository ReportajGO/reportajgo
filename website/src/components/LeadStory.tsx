import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PostDTO } from "@/lib/posts";
import { splitLeadingEmoji } from "@/lib/title";
import Cover from "./Cover";
import Meta from "./Meta";

/** Hero story with a large cover and headline. */
export default async function LeadStory({ post }: { post: PostDTO }) {
  const t = await getTranslations("home");
  const { emoji, text: titleText } = splitLeadingEmoji(post.title);

  return (
    <Link href={`/article/${post.id}`} className="group block">
      <div className="relative">
        <Cover
          category={post.category}
          imageUrl={post.imageUrl}
          variant="lead"
          className="mb-3.5 h-[230px] sm:mb-4 sm:h-[340px] lg:h-[430px]"
        />
        {post.breaking && (
          <span className="absolute left-3 top-3 z-[3] animate-pulse rounded bg-brand-red px-2.5 py-1 font-display text-[11px] font-extrabold uppercase tracking-[.1em] text-white sm:left-4 sm:top-4">
            {t("breaking")}
          </span>
        )}
      </div>
      <div className="mb-2">
        <Meta category={post.category} createdAt={post.createdAt} />
      </div>
      <h1 className="mb-2 font-serif text-[24px] font-bold leading-[1.13] tracking-tight transition-colors group-hover:text-brand-red sm:mb-2.5 sm:text-[32px] sm:leading-[1.1] lg:text-[40px] lg:leading-[1.08]">
        {emoji && (
          <span className="mr-2 align-[0.06em] text-[0.74em]">{emoji}</span>
        )}
        {titleText}
      </h1>
      <p className="text-[16px] text-ink-soft sm:text-[18px] lg:text-[19px]">
        {post.excerpt}
      </p>
    </Link>
  );
}
