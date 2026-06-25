import { setRequestLocale, getTranslations } from "next-intl/server";
import PostForm from "@/components/admin/PostForm";

export default async function NewPostPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight">
        {t("newPost")}
      </h1>
      <PostForm />
    </div>
  );
}
