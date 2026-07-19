/// Crudely reduces HTML to readable text: drops script/style blocks, strips
/// tags, and decodes the handful of common entities. Not a full parser — just
/// enough to keep tool output legible.

const DROPPED_BLOCKS = ["script", "style", "head", "noscript", "svg"];

export function htmlToText(html: string): string {
  let withoutBlocks = html;
  for (const block of DROPPED_BLOCKS) {
    const pattern = new RegExp(`<${block}[^>]*>.*?</\\s*${block}\\s*>`, "gis");
    withoutBlocks = withoutBlocks.replace(pattern, " ");
  }
  const spaced = withoutBlocks.replace(
    /<\/(p|div|br|li|tr|h[1-6])\s*>/gi,
    "\n",
  );
  const stripped = spaced.replace(/<[^>]+>/g, "");
  const decoded = stripped
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");
  // Collapse the runs of blank lines tag-stripping leaves behind.
  const collapsed = decoded.replace(/[ \t]*\n[ \t]*(\n[ \t]*)+/g, "\n\n");
  return collapsed.trim();
}
