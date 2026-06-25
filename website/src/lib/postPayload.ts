import { saveImage } from "./upload";

// Parsed payload shared by JSON and multipart submissions.
export type PostInput = {
  title?: string;
  excerpt?: string;
  content?: string;
  category?: string;
  language?: string;
  breaking?: boolean;
  published?: boolean;
  // resolved image URL: a saved upload path, a kept value, or null to clear.
  // `undefined` means "field not provided" (keep existing on update).
  imageUrl?: string | null;
  // true when a brand-new file was uploaded in this request.
  uploadedNewImage: boolean;
};

/**
 * Accept either multipart/form-data (file upload from the admin form) or
 * application/json (programmatic clients). For multipart, an uploaded `image`
 * file is saved to public/uploads and its URL is placed in `imageUrl`.
 */
export async function parsePostInput(req: Request): Promise<PostInput> {
  const ctype = req.headers.get("content-type") ?? "";

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const has = (k: string) => form.has(k);

    let imageUrl: string | null | undefined;
    let uploadedNewImage = false;
    const file = form.get("image");
    if (file instanceof File && file.size > 0) {
      imageUrl = await saveImage(file);
      uploadedNewImage = true;
    } else if (has("removeImage") && str("removeImage") === "true") {
      imageUrl = null; // explicit clear
    } else if (has("imageUrl")) {
      imageUrl = str("imageUrl") || null;
    } else {
      imageUrl = undefined; // not provided — keep existing
    }

    const publishedRaw = str("published");
    return {
      title: str("title"),
      excerpt: str("excerpt"),
      content: str("content"),
      category: str("category"),
      language: str("language"),
      breaking: has("breaking") ? str("breaking") === "true" : undefined,
      published: publishedRaw === undefined ? undefined : publishedRaw === "true",
      imageUrl,
      uploadedNewImage,
    };
  }

  const body = await req.json();
  return {
    title: body.title,
    excerpt: body.excerpt,
    content: body.content,
    category: body.category,
    language: body.language,
    breaking: body.breaking,
    published: body.published,
    imageUrl: body.imageUrl,
    uploadedNewImage: false,
  };
}
