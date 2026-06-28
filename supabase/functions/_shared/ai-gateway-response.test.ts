import { describe, it, expect } from "vitest";
import { checkAiGatewayResponse } from "./ai-gateway-response";

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

describe("checkAiGatewayResponse", () => {
  it("returns null for a successful response", async () => {
    const response = new Response(JSON.stringify({ choices: [] }), { status: 200 });
    await expect(checkAiGatewayResponse(response, corsHeaders)).resolves.toBeNull();
  });

  it("returns a 429 Response with a clear error message when rate-limited", async () => {
    const response = new Response("Too Many Requests", { status: 429 });
    const result = await checkAiGatewayResponse(response, corsHeaders);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    const body = await result!.json();
    expect(body.error).toBe("Rate limited, please try again shortly.");
  });

  it("preserves the provided CORS headers on the 429 response", async () => {
    const response = new Response("Too Many Requests", { status: 429 });
    const result = await checkAiGatewayResponse(response, corsHeaders);
    expect(result!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("throws for a 500 error, including the response body in the message", async () => {
    const response = new Response("Internal Server Error details", { status: 500 });
    await expect(checkAiGatewayResponse(response, corsHeaders)).rejects.toThrow(
      "AI API error: 500 - Internal Server Error details"
    );
  });

  it("returns a 402 Response with a clear error message for payment-required", async () => {
    const response = new Response("Payment required", { status: 402 });
    const result = await checkAiGatewayResponse(response, corsHeaders);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(402);
    const body = await result!.json();
    expect(body.error).toBe("Service temporarily unavailable.");
  });

  it("throws for a 401 (unauthorized) error", async () => {
    const response = new Response("Unauthorized", { status: 401 });
    await expect(checkAiGatewayResponse(response, corsHeaders)).rejects.toThrow("AI API error: 401");
  });
});
