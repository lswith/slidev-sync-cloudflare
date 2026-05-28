// Single-DO Worker dispatcher.
//
// All rooms are held in one Durable Object instance per Worker deployment.
// This matches the upstream slidev-sync-server's single-process model exactly
// (room id lives in the message payload, not the URL) so slidev-addon-sync
// is drop-in compatible with zero changes.

import { SyncRoom } from "./room.js";
import { corsOrigin, isOriginAllowed, parseAllowlist } from "./origin.js";

export { SyncRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowlist = parseAllowlist(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return preflight(origin, allowlist);
    }

    if (!isOriginAllowed(origin, allowlist)) {
      return new Response("origin not allowed", { status: 403 });
    }

    const id = env.SYNC_ROOM.idFromName("default");
    const stub = env.SYNC_ROOM.get(id);
    const response = await stub.fetch(request);

    // Reflect CORS for SSE / HTTP responses (WS 101 responses can't carry custom headers).
    const allow = corsOrigin(origin, allowlist);
    if (allow && response.status !== 101) {
      const out = new Response(response.body, response);
      out.headers.set("Access-Control-Allow-Origin", allow);
      if (allow !== "*") out.headers.append("Vary", "Origin");
      return out;
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

function preflight(origin: string | null, allowlist: string[] | "*"): Response {
  const allow = corsOrigin(origin, allowlist);
  if (!allow) return new Response(null, { status: 403 });
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "2592000",
  };
  if (allow !== "*") headers.Vary = "Origin";
  return new Response(null, { status: 204, headers });
}
