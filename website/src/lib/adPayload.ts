import { saveImage, saveImageFromUrl } from "./upload";

// Parsed ad payload shared by JSON and multipart submissions. For every optional
// field, `undefined` means "not provided — keep existing" (used on update).
export type AdInput = {
  title?: string;
  slot?: string;
  linkUrl?: string | null;
  published?: boolean;
  order?: number;
  // Flight window. undefined = keep, null = clear, Date = set.
  startsAt?: Date | null;
  endsAt?: Date | null;
  // Resolved creative URL: a saved upload path, a kept value, or null to clear.
  imageUrl?: string | null;
  // true when a brand-new file was uploaded in this request.
  uploadedNewImage: boolean;
};

/** Parse "" → null, a valid date string → Date; returns undefined when absent. */
function parseDateField(
  present: boolean,
  raw: string | undefined,
): Date | null | undefined {
  if (!present) return undefined;
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Accept either multipart/form-data (admin form with an uploaded creative) or
 * application/json (e.g. a one-click publish toggle). For multipart an uploaded
 * `image` file is saved to /uploads and its URL is placed in `imageUrl`.
 */
export async function parseAdInput(req: Request): Promise<AdInput> {
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
    const orderRaw = str("order");
    const order =
      orderRaw === undefined || orderRaw.trim() === ""
        ? undefined
        : Number.parseInt(orderRaw, 10);

    return {
      title: str("title"),
      slot: str("slot"),
      linkUrl: has("linkUrl") ? str("linkUrl") || null : undefined,
      published: publishedRaw === undefined ? undefined : publishedRaw === "true",
      order: order !== undefined && Number.isNaN(order) ? undefined : order,
      startsAt: parseDateField(has("startsAt"), str("startsAt")),
      endsAt: parseDateField(has("endsAt"), str("endsAt")),
      imageUrl,
      uploadedNewImage,
    };
  }

  const body = await req.json();

  // JSON clients may pass a remote image URL to re-host, or a kept /uploads path.
  let imageUrl: string | null | undefined;
  let uploadedNewImage = false;
  if (typeof body.imageSourceUrl === "string" && body.imageSourceUrl) {
    imageUrl = await saveImageFromUrl(body.imageSourceUrl);
    uploadedNewImage = true;
  } else if ("imageUrl" in body) {
    imageUrl = body.imageUrl ?? null;
  } else {
    imageUrl = undefined;
  }

  const hasKey = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  return {
    title: body.title,
    slot: body.slot,
    linkUrl: hasKey("linkUrl") ? body.linkUrl ?? null : undefined,
    published: typeof body.published === "boolean" ? body.published : undefined,
    order: typeof body.order === "number" ? body.order : undefined,
    startsAt: hasKey("startsAt") ? parseDateField(true, body.startsAt) : undefined,
    endsAt: hasKey("endsAt") ? parseDateField(true, body.endsAt) : undefined,
    imageUrl,
    uploadedNewImage,
  };
}
