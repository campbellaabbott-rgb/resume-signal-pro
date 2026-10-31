import type { ReactNode } from "react";

/**
 * A translated sentence whose <tag>…</tag> spans become the elements the
 * caller names ("<trust>Trust</trust> lists every copy", "<ph>[number]</ph>").
 * Nothing else is parsed and the text is never set as HTML. The homepage uses
 * this instead of react-i18next's Trans, which is about 4 KB gzip that "/"
 * loaded for three sentences.
 */
export function TaggedText({ text, tags }: { text: string; tags: Record<string, (inner: string, key: number) => ReactNode> }) {
  const parts: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const make = tags[m[1]];
    parts.push(make ? make(m[2], m.index) : m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
