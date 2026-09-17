// /mcp — "THIS IS NOT THE SERVER ADDRESS."
//
// Measured 2026-09-16: https://resumebooster.work/mcp answered 200 with the
// SPA shell, so a person who "fixed" the odd-looking Supabase address by
// typing the branded one landed on the homepage and learned nothing. The
// real address stays the only address (a redirect from here would drop the
// Authorization header on some hosts — claude.com's troubleshooting page
// says so — and a proxy would fork the resource identity the OAuth server
// binds tokens to), so this route is a tiny page that says so, shows the
// real address with its one sentence, and links the how-to. noindex, listed
// nowhere, prerendered (scripts/prerender-seo.mjs) so a curl sees the same.
// A host that POSTs here still fails at initialize — the same as before,
// and no page can change that.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MCP_SERVER_ADDRESS_NOTE } from "@/config/mcp-tools";
// The URL comes from the test-button client, not from the /agents page, so
// this twenty-line route does not pull the whole switchboard chunk.
import { MCP_URL } from "@/lib/mcp-test";

/** The address with a copy button — the same shape as the /agents CopyBlock, kept local so the page loads alone. */
function AddressBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="text-xs overflow-x-auto p-3 pr-12 rounded-lg bg-muted whitespace-pre-wrap break-all"><code>{code}</code></pre>
      <button
        type="button"
        aria-label="Copy the server address"
        onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-2 right-2 p-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export const MCP_NOT_HERE_TITLE = "This is not the server address";

export default function McpNotHere() {
  return (
    <>
      <SEO
        title={MCP_NOT_HERE_TITLE}
        description="The MCP server for AI agents lives at a Supabase address, not here. The real address and the how-to are one click away."
        path="/mcp"
        noIndex
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-2xl">
          <h1 className="text-2xl font-bold mb-3">{MCP_NOT_HERE_TITLE}</h1>
          <p className="text-muted-foreground mb-4">
            The server your agent talks to is not at this URL. This is the address it needs:
          </p>
          <AddressBlock code={MCP_URL} />
          <p className="text-sm text-muted-foreground mt-3">{MCP_SERVER_ADDRESS_NOTE}</p>
          <p className="text-sm mt-6">
            <Link to="/agents" className="text-primary hover:underline">How to connect your agent, app by app →</Link>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
