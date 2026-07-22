import { Link } from "@/i18n/navigation";
import type { PostDTO } from "@/lib/posts";
import { splitLeadingEmoji } from "@/lib/title";
import CardShare from "./CardShare";
import Cover from "./Cover";
import Meta from "./Meta";

/** Standard grid card. */
export default function NewsCard({ post }: { post: PostDTO }) {
  const { emoji, text: titleText } = splitLeadingEmoji(post.title);
  return (
    <div className="group flex flex-col">
      {/* Cover is its own link; the share control sits over it as a sibling so
          its clicks never trigger card navigation. */}
      <div className="relative mb-3">
        <Link href={`/article/${post.id}`} aria-hidden tabIndex={-1} className="block">
          <Cover
            category={post.category}
            imageUrl={post.imageUrl}
            variant="card"
            className="h-[200px] sm:h-[172px]"
          />
        </Link>
        <div className="absolute right-2 top-2">
          <CardShare id={post.id} title={post.title} />
        </div>
      </div>
      <Link href={`/article/${post.id}`} className="flex flex-1 flex-col">
        <h3 className="mb-[7px] font-serif text-xl font-semibold leading-tight tracking-tight transition-colors group-hover:text-brand-red">
          {emoji && <span className="mr-1.5 text-[0.82em]">{emoji}</span>}
          {titleText}
        </h3>
        <p className="mb-2.5 line-clamp-3 text-[15.5px] leading-snug text-ink-soft">
          {post.excerpt}
        </p>
        <div className="mt-auto">
          <Meta
            categoryName={post.categoryName}
            createdAt={post.createdAt}
          />
        </div>
      </Link>
    </div>
  );
}
