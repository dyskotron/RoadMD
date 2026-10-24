// A minimal MCP client over Streamable HTTP: JSON-RPC POSTs, answers as JSON or as one server-sent event.
// Enough for a stateless server such as Encyclist (each request on its own); no SDK, no dependencies (Node 18 fetch).
//
//   const mcp = mcpClient({ url, headers: { "X-API-Key": key } });
//   await mcp.call("ec_stats", {})   → the tool's result as a JS value (its JSON text parsed), or throws McpError

export class McpError extends Error {
  constructor(message, { tool, code } = {}) { super(message); this.tool = tool; this.code = code; }
}

export function mcpClient({ url, headers = {}, timeoutMs = 60000 }) {
  let id = 0, session = null, ready = null;

  async function rpc(method, params, { notify = false } = {}) {
    const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}), ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.headers.get("mcp-session-id")) session = res.headers.get("mcp-session-id");
    if (res.status === 401 || res.status === 403) throw new McpError(`${url}: not authorised (${res.status}): check the API key`, { code: res.status });
    if (notify) return null;
    if (!res.ok) throw new McpError(`${url}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, { code: res.status });
    const text = await res.text();
    const msg = (res.headers.get("content-type") || "").includes("text/event-stream") ? fromEvents(text, body.id) : JSON.parse(text);
    if (msg.error) throw new McpError(`${method}: ${msg.error.message}`, { code: msg.error.code });
    return msg.result;
  }

  function fromEvents(text, wanted) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg.id === wanted) return msg;
    }
    throw new McpError(`no answer to request ${wanted} in the event stream`);
  }

  function initialize() {
    return (ready ||= (async () => {
      await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "roadmd", version: "0.2" } });
      await rpc("notifications/initialized", null, { notify: true });
    })());
  }

  return {
    async tools() { await initialize(); return (await rpc("tools/list", {})).tools; },
    async call(tool, args = {}) {
      await initialize();
      const r = await rpc("tools/call", { name: tool, arguments: args });
      const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (r.isError) throw new McpError(`${tool}: ${text || "failed"}`, { tool });
      const s = r.structuredContent;
      if (s && typeof s === "object" && Object.keys(s).length === 1 && "result" in s) return s.result;
      if (s !== undefined && s !== null) return s;
      try { return JSON.parse(text); } catch { return text; }
    },
  };
}
