// aiAskStream SSE-client tests (v1.71, ADR-082) — keyless/offline. A fake streamed Response drives
// the parser; no real network. Covers happy-path event dispatch (incl. a frame split across chunks),
// a pre-flush JSON error envelope, and a mid-stream `error` event.
import { describe, it, expect, vi, afterEach } from "vitest";
import { aiAskStream } from "./aiClient";

const enc = new TextEncoder();

/** A minimal fetch Response whose body streams the given UTF-8 chunks in order. */
function streamResponse(chunks: string[]): Response {
  const encoded = chunks.map((c) => enc.encode(c));
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "text/event-stream" : null) },
    body: {
      getReader: () => ({
        read: async () =>
          i < encoded.length ? { done: false, value: encoded[i++] } : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

/** A JSON error envelope response (pre-flush failure — before the SSE stream starts). */
function jsonErrorResponse(status: number, code: string, message: string): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => ({ ok: false, error: { code, message } }),
  } as unknown as Response;
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiAskStream (v1.71, ADR-082)", () => {
  it("dispatches step/delta/cards to handlers and resolves to the final answer (frame split across chunks)", async () => {
    const stepFrame = frame("step", { type: "step", tools: ["get_active_sprint"] });
    const chunks = [
      // split the step frame mid-way to exercise the buffer's \n\n boundary detection
      stepFrame.slice(0, 12),
      stepFrame.slice(12),
      frame("delta", { type: "delta", text: "Hello " }),
      frame("delta", { type: "delta", text: "world" }),
      frame("cards", { type: "cards", cards: [{ kind: "sprint", data: { sprint: { name: "S1" } } }] }),
      frame("done", {
        type: "done",
        answer: "Hello world",
        toolsUsed: ["get_active_sprint"],
        provider: "anthropic",
        model: "m",
        cards: [{ kind: "sprint", data: { sprint: { name: "S1" } } }],
      }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks)));

    const steps: string[][] = [];
    const deltas: string[] = [];
    let cardsSeen = 0;
    const res = await aiAskStream(
      { question: "how is the sprint?" },
      {
        onStep: (t) => steps.push(t),
        onDelta: (d) => deltas.push(d),
        onCards: (c) => (cardsSeen = c.length),
      }
    );

    expect(steps).toEqual([["get_active_sprint"]]);
    expect(deltas.join("")).toBe("Hello world");
    expect(cardsSeen).toBe(1);
    expect(res.answer).toBe("Hello world");
    expect(res.toolsUsed).toEqual(["get_active_sprint"]);
    expect(res.cards?.[0]!.kind).toBe("sprint");
  });

  it("resolves a `proposed` event into a proposedAction result", async () => {
    const chunks = [
      frame("proposed", {
        type: "proposed",
        answer: "",
        proposedAction: { tool: "update_ticket", args: { ticketKey: "DEV-1", storyPoints: 3 } },
        toolsUsed: ["update_ticket"],
        provider: "anthropic",
        model: "m",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks)));

    const res = await aiAskStream({ question: "set DEV-1 to 3" });
    expect(res.proposedAction).toEqual({ tool: "update_ticket", args: { ticketKey: "DEV-1", storyPoints: 3 } });
  });

  it("throws the McpError from a pre-flush JSON error envelope (AI_UNAVAILABLE)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonErrorResponse(503, "AI_UNAVAILABLE", "AI is disabled"))
    );

    await expect(aiAskStream({ question: "hi" })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  it("throws on a mid-stream `error` event", async () => {
    const chunks = [frame("error", { type: "error", code: "UPSTREAM", message: "provider blew up" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks)));

    await expect(aiAskStream({ question: "hi" })).rejects.toMatchObject({ code: "UPSTREAM" });
  });

  it("maps a network failure to BRIDGE_DOWN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await expect(aiAskStream({ question: "hi" })).rejects.toMatchObject({ code: "BRIDGE_DOWN" });
  });
});
