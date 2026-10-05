/**
 * THE SIGNED-IN CALLER'S OWN ADDRESS, OR NOTHING.
 *
 * check-subscription, create-subscription-checkout and create-agent-checkout
 * used to take an email from the request body and answer, for anybody,
 * whether that address held a subscription (and spent unmetered Stripe calls
 * finding out). An address in a body is a claim; a token the auth server
 * signed is proof. This reads only the token.
 *
 * The publishable key every visitor holds is not a user and is never sent to
 * the auth server, so an anonymous request costs no round trip. A token the
 * auth server refuses is an anonymous request, not an error -- and it must
 * never fall through to a body address, which is the hole this closes.
 *
 * Pure apart from the client it is handed: importable by Deno and by vitest.
 */
import { bearerOf } from "./service-caller.ts";

type AuthLike = {
  getUser: (jwt: string) => Promise<{ data?: { user?: { email?: string | null } | null } | null; error?: unknown }>;
};

export async function signedInEmail(auth: AuthLike, headers: Headers, publishableKey: string): Promise<string | null> {
  const token = bearerOf(headers);
  if (!token || (publishableKey && token === publishableKey)) return null;
  try {
    const { data } = await auth.getUser(token);
    const email = data?.user?.email;
    return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
