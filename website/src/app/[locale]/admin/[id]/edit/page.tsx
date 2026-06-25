import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPostById } from "@/lib/posts";
import PostForm, { type PostFormData } from "@/components/admin/PostForm";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const post = await getPostById(id);
  if (!post) notFound();

  const t = await getTranslations("admin");

  const initial: PostFormData = {
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    content: post.body,
    category: post.category,
    language: post.language,
    imageUrl: post.imageUrl ?? "",
    breaking: post.breaking,
    published: post.published,
  };

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight">
        {t("editPost")}
      </h1>
      <PostForm initial={initial} />
    </div>
  );
}
