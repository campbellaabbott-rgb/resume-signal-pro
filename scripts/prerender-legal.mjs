// The full text of /privacy and /terms for the bake, read from the SAME
// source the app renders (SEO-029, S13-133). Pure: the caller reads the files
// and hands their text in.
//
// MEASURED 2026-10-18: the baked /privacy carried 1,212 characters of body and
// /terms 1,016: the title, "last updated", a sentence saying the full text
// renders in a browser, and the section headings. Every clause (the retention
// windows, the rights, the section-4 refund terms) existed only after
// JavaScript, while llms.txt told answer engines that every sitemap page reads
// without it. The clause text is English JSX literals in src/pages/Privacy.tsx
// and src/pages/Terms.tsx; copying it into a second file would be a second
// copy of a legal text, the one kind of copy that must never drift. So the
// bake reads those two files and converts the policy body (every <section>)
// to plain HTML: headings from the main locale (the keys the page renders),
// interpolations from the same constants the page imports, a router link as a
// link, every class and handler dropped. Anything it does not recognise (a
// component, an expression it has no value for) throws, and the caller falls
// back to the headings page and says so in the log: never a half-converted
// policy.

const ALLOWED = new Set(["section", "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "b", "i", "a", "br", "div", "span"]);

/** A dotted key's value in a locale object, or undefined. */
const lookup = (obj, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

/**
 * The policy body of a legal page's TSX source as HTML.
 * `locale` is the main English locale (en.json); `vars` maps every bare
 * identifier the body interpolates ({AI_CACHE_MAX_HOURS}) to its value.
 */
export function legalBodyFromTsx(source, { locale, vars = {}, esc }) {
  const src = String(source ?? "");
  const start = src.indexOf("<section");
  const end = src.lastIndexOf("</section>");
  if (start < 0 || end < start) throw new Error("no <section> body found");
  let body = src.slice(start, end + "</section>".length);
  // JSX comments.
  body = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // {t('key')} and {t("key")}: the main locale's string.
  body = body.replace(/\{\s*t\(\s*(['"])([^'"]+)\1\s*(?:,[^)]*)?\)\s*\}/g, (_, _q, key) => {
    const v = lookup(locale, key);
    if (typeof v !== "string") throw new Error(`no main-locale string for ${key}`);
    return esc(v);
  });
  // {' '} and {" "}.
  body = body.replace(/\{\s*(['"])\s\1\s*\}/g, " ");
  // A bare identifier the page imports.
  body = body.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`no value for {${name}}`);
    return esc(String(vars[name]));
  });
  if (/[{}]/.test(body)) throw new Error(`an expression the bake cannot read: ${(body.match(/\{[^}]{0,60}/) || [""])[0]}`);
  // Tags: a router Link is a link; every attribute but href goes.
  body = body.replace(/<(\/?)([A-Za-z][\w.]*)((?:\s+[^>]*?)?)(\/?)>/g, (_, close, tag, attrs, self) => {
    let name = tag;
    let href = null;
    if (tag === "Link") {
      name = "a";
      const m = /\bto="([^"]*)"/.exec(attrs || "");
      href = m ? m[1] : null;
    } else if (tag === "a") {
      const m = /\bhref="([^"]*)"/.exec(attrs || "");
      href = m ? m[1] : null;
    }
    if (!ALLOWED.has(name)) throw new Error(`a component the bake cannot render: <${tag}>`);
    if (close) return `</${name}>`;
    if (name === "br") return "<br>";
    if (self) return "";
    return href !== null ? `<${name} href="${href}">` : `<${name}>`;
  });
  return body.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** The visible text of a converted body, for the length and sentence checks. */
export const legalText = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
