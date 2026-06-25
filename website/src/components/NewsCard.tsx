import { Link } from "@/i18n/navigation";
import type { PostDTO } from "@/lib/posts";
import { splitLeadingEmoji } from "@/lib/title";
import Cover from "./Cover";
import Meta from "./Meta";

/** Standard grid card. */
export default function NewsCard({ post }: { post: PostDTO }) {
  const { emoji, text: titleText } = splitLeadingEmoji(post.title);
  return (
    <Link href={`/article/${post.id}`} className="group flex flex-col">
      <Cover
        category={post.category}
        imageUrl={post.imageUrl}
        variant="card"
        className="mb-3 h-[200px] sm:h-[172px]"
      />
      <h3 className="mb-[7px] font-serif text-xl font-semibold leading-tight tracking-tight transition-colors group-hover:text-brand-red">
        {emoji && <span className="mr-1.5 text-[0.82em]">{emoji}</span>}
        {titleText}
      </h3>
      <p className="mb-2.5 line-clamp-3 text-[15.5px] leading-snug text-ink-soft">
        {post.excerpt}
      </p>
      <div className="mt-auto">
        <Meta
          category={post.category}
          createdAt={post.createdAt}
          views={post.views}
        />
      </div>
    </Link>
  );
}
