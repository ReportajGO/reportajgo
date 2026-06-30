import { Link } from "@/i18n/navigation";
import type { PostDTO } from "@/lib/posts";
import { splitLeadingEmoji } from "@/lib/title";
import Cover from "./Cover";
import Meta from "./Meta";

/** Compact "trending" row: headline + tiny thumbnail. */
export default function SideItem({ post }: { post: PostDTO }) {
  const { emoji, text: titleText } = splitLeadingEmoji(post.title);
  return (
    <Link
      href={`/article/${post.id}`}
      className="group grid grid-cols-[1fr_auto] items-start gap-3.5 border-b border-line py-4"
    >
      <div>
        <h3 className="mb-1.5 font-serif text-[17px] font-semibold leading-tight transition-colors group-hover:text-brand-red sm:text-[19px]">
          {emoji && <span className="mr-1.5 text-[0.85em]">{emoji}</span>}
          {titleText}
        </h3>
        <Meta categoryName={post.categoryName} createdAt={post.createdAt} />
      </div>
      <Cover
        category={post.category}
        imageUrl={post.imageUrl}
        variant="thumb"
        className="h-[72px] w-24 shrink-0 rounded-lg"
      />
    </Link>
  );
}
