// Renders a JSON-LD structured-data block. Data is server-controlled (built
// from our own DB), but we still escape "<" so a stray "</script>" in any text
// field can't break out of the script element (XSS-safe by construction).
export default function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
