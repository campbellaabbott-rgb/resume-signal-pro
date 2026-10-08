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
  getUser: (jwt: string) => Promise<{ data?: { user?: { id?: string | null; email?: string | null } | null } | null; error?: unknown }>;
};

export async function signedInEmail(auth: AuthLike, headers: Headers, publishableKey: string): Promise<string | null> {
  return (await signedInUser(auth, headers, publishableKey))?.email ?? null;
}

/**
 * The same verified caller, with the auth user id beside the address: the id
 * is what entitlement is read by (pro_entitlement_rows, agent_subscription_rows)
 * and what a subscription checkout stamps on the plan it sells. null for an
 * anonymous request or a token the auth server refuses.
 */
export async function signedInUser(
  auth: AuthLike,
  headers: Headers,
  publishableKey: string,
): Promise<{ id: string; email: string } | null> {
  const token = bearerOf(headers);
  if (!token || (publishableKey && token === publishableKey)) return null;
  try {
    const { data } = await auth.getUser(token);
    const email = data?.user?.email;
    const id = data?.user?.id;
    if (typeof email !== "string" || !email.includes("@")) return null;
    return { id: typeof id === "string" ? id : "", email: email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
