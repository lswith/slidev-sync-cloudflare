import { DurableObject } from "cloudflare:workers";
import {
  type ConnectData,
  type PatchData,
  type ReplaceData,
  type States,
  type WsData,
  EventType,
  isConnectData,
  isPatchData,
  isReplaceData,
  isResetData,
} from "./protocol.js";
import {
  type Groups,
  initGroup,
  patchGroup,
  removeOldGroups,
  replaceGroup,
} from "./groups.js";

interface SocketAttachment {
  groupId: string;
  uid: string;
}

interface SseClient {
  groupId: string;
  uid: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

interface SerializedGroup {
  created: string;
  states: States;
  updated: string;
}
type SerializedGroups = Record<string, SerializedGroup>;

const GROUPS_KEY = "groups:v1";

// Cap to limit storage spam. A single deployment with thousands of legitimately
// open rooms is implausible — this just stops an attacker that bypassed Origin
// checks (e.g. via curl) from filling DO storage indefinitely. The 3-day GC
// from upstream still applies on top.
const MAX_GROUPS = 1000;

export class SyncRoom extends DurableObject<Env> {
  private groups: Groups = new Map();
  // SSE clients indexed by uid (one stream per uid, matching upstream).
  private sseByUid: Map<string, SseClient> = new Map();
  private encoder = new TextEncoder();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<SerializedGroups>(GROUPS_KEY);
      if (stored) {
        for (const [id, g] of Object.entries(stored)) {
          this.groups.set(id, {
            created: new Date(g.created),
            states: g.states,
            updated: new Date(g.updated),
          });
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade();
    }

    // SSE event stream (GET /event?uid=<uid>)
    if (
      request.method === "GET" &&
      url.pathname === "/event" &&
      request.headers.get("Accept") === "text/event-stream"
    ) {
      return this.handleSseStream(url);
    }

    // SSE HTTP control endpoints
    if (request.method === "POST") {
      const uid = url.searchParams.get("uid");
      if (!uid || !this.sseByUid.has(uid)) {
        return new Response("uid not registered", { status: 400 });
      }
      const body = (await request.json()) as Record<string, unknown>;
      switch (url.pathname) {
        case "/connect": {
          const data = body as unknown as ConnectData;
          const preExisting = this.handleConnect(data, uid);
          if (preExisting) {
            const sse = this.sseByUid.get(uid);
            const group = this.groups.get(data.id);
            if (sse && group) this.sendToSse(sse.controller, group.states, undefined, EventType.REPLACE);
          }
          break;
        }
        case "/patch":
          this.handlePatch(body as unknown as PatchData, uid);
          break;
        case "/replace":
          this.handleReplace(body as unknown as ReplaceData, uid);
          break;
        case "/reset":
          this.handleReset((body as { id: string }).id, uid);
          break;
        default:
          return new Response("not found", { status: 404 });
      }
      return new Response(null, { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }

  // ============ WebSocket ============

  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    let data: WsData;
    try {
      const text =
        typeof message === "string" ? message : new TextDecoder().decode(message);
      data = JSON.parse(text) as WsData;
    } catch {
      return;
    }

    if (isConnectData(data)) {
      ws.serializeAttachment({ groupId: data.id, uid: data.uid } satisfies SocketAttachment);
      const preExisting = this.handleConnect(data, data.uid);
      if (preExisting) {
        const group = this.groups.get(data.id)!;
        this.sendToWs(ws, group.states, undefined, EventType.REPLACE);
      }
      return;
    }
    if (isPatchData(data)) {
      this.handlePatch(data, data.uid);
      return;
    }
    if (isReplaceData(data)) {
      this.handleReplace(data, data.uid);
      return;
    }
    if (isResetData(data)) {
      this.handleReset(data.id, data.uid);
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // No-op: getWebSockets() no longer returns this socket; nothing else to clean up.
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // No-op
  }

  // ============ SSE ============

  private handleSseStream(url: URL): Response {
    const uid = url.searchParams.get("uid");
    if (!uid) return new Response("missing uid", { status: 400 });

    let registered: SseClient | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // groupId is set on /connect; until then the client is "uid-only".
        registered = { groupId: "", uid, controller };
        this.sseByUid.set(uid, registered);
        controller.enqueue(this.encoder.encode("retry: 3000\n\n"));
      },
      cancel: () => {
        if (registered && this.sseByUid.get(uid) === registered) {
          this.sseByUid.delete(uid);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ============ core ops (shared by WS + SSE) ============

  /**
   * Returns true if the group already existed before this connect (so callers
   * should echo the current state back to the new client, matching upstream
   * sync-server semantics). Returns false if this connect just initialized
   * the group — in which case the new client is the source of truth and gets
   * no echo.
   */
  private handleConnect(data: ConnectData, uid?: string): boolean {
    if (!data.id) return false;
    if (uid) {
      const sse = this.sseByUid.get(uid);
      if (sse) sse.groupId = data.id;
    }
    removeOldGroups(this.groups);
    const preExisting = this.groups.has(data.id);
    if (!preExisting) {
      if (this.groups.size >= MAX_GROUPS) {
        // Refuse silently — caller treats this as a connect that opened no
        // room, which means subsequent patches no-op. Prevents storage spam
        // from a non-browser client that bypassed Origin checks.
        return false;
      }
      initGroup(this.groups, data.id, data.states ?? {});
    } else if (data.states) {
      this.handlePatch({ id: data.id, states: data.states, full: data.full }, uid);
    }
    this.persistGroups();
    return preExisting;
  }

  private handlePatch(data: PatchData, uid?: string): void {
    if (!data.id || !this.groups.has(data.id)) return;
    patchGroup(this.groups, data.id, data.states);
    let states = data.states;
    if (data.full) {
      const group = this.groups.get(data.id)!;
      states = Object.fromEntries(
        Object.keys(data.states).map((key) => [key, group.states[key]]),
      );
    }
    this.broadcast(data.id, states, uid, EventType.PATCH);
    this.persistGroups();
  }

  private handleReplace(data: ReplaceData, uid?: string): void {
    if (!data.id || !this.groups.has(data.id)) return;
    replaceGroup(this.groups, data.id, data.states);
    this.broadcast(data.id, data.states, uid, EventType.REPLACE);
    this.persistGroups();
  }

  private handleReset(id: string, uid?: string): void {
    if (!id || !this.groups.has(id)) return;
    replaceGroup(this.groups, id, {});
    this.broadcast(id, {}, uid, EventType.REPLACE);
    this.persistGroups();
  }

  // ============ broadcasting ============

  private broadcast(groupId: string, states: States, senderUid: string | undefined, type: EventType): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att || att.groupId !== groupId) continue;
      if (senderUid !== undefined && att.uid === senderUid) continue;
      this.sendToWs(ws, states, senderUid, type);
    }
    for (const c of this.sseByUid.values()) {
      if (c.groupId !== groupId) continue;
      if (senderUid !== undefined && c.uid === senderUid) continue;
      this.sendToSse(c.controller, states, senderUid, type);
    }
  }

  private sendToWs(ws: WebSocket, states: States, uid: string | undefined, type: EventType): void {
    try {
      ws.send(JSON.stringify({ type, states, uid }));
    } catch {
      // Connection closed mid-broadcast — ignore.
    }
  }

  private sendToSse(
    controller: ReadableStreamDefaultController<Uint8Array>,
    states: States,
    uid: string | undefined,
    type: EventType,
  ): void {
    try {
      controller.enqueue(
        this.encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ states, uid })}\n\n`),
      );
    } catch {
      // Stream closed mid-broadcast — ignore.
    }
  }

  private persistGroups(): void {
    const ser: SerializedGroups = {};
    for (const [id, g] of this.groups.entries()) {
      ser[id] = {
        created: g.created.toISOString(),
        states: g.states,
        updated: g.updated.toISOString(),
      };
    }
    void this.ctx.storage.put(GROUPS_KEY, ser);
  }
}
