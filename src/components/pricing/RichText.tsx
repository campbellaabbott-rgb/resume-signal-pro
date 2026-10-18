/**
 * A translated sentence with two kinds of inline markup a translator can move:
 * <link>…</link> becomes the link the caller passes, and <b>…</b> bold text.
 * Nothing else is parsed, and the text is never set as HTML.
 */
import type { ReactNode } from "react";

export function RichText({ text, link }: { text: string; link?: (inner: string, key: number) => ReactNode }) {
  const parts: ReactNode[] = [];
  const re = /<(link|b)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] === "b") parts.push(<b key={m.index} className="font-semibold text-foreground">{m[2]}</b>);
    else parts.push(link ? link(m[2], m.index) : m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
