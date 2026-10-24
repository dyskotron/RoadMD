// An in-memory stand-in for an Encyclist MCP server: the entity tools roadmd's adapter uses, over Streamable HTTP
// (JSON answers, or one server-sent event when asked with ?sse), an X-API-Key check. For tests only.
import http from "node:http";

export async function startFakeEncyclist({ key = "test-key", sse = false, docs: seed = [] } = {}) {
  const types = new Map(), entities = new Map(), docs = new Map(), rels = new Map();
  let n = 0;
  const now = () => new Date(Date.now() + n).toISOString();
  for (const d of seed) docs.set(d.doc_id, { tags: [], source: "", ...d });
  const tools = {
    ec_doc_list: ({ limit = 20, offset = 0 }) => { const all = [...docs.values()]; return { total: all.length, docs: all.slice(offset, offset + limit).map(({ content, ...d }) => d) }; },
    ec_doc_get: ({ doc_id }) => { const d = docs.get(doc_id); if (!d) throw new Error(`Document not found: '${doc_id}'`); return d; },
    ec_rel_query: ({ from_id, to_id, relation }) => ({ relationships: [...rels.values()].filter((r) => (!from_id || r.from_id === from_id) && (!to_id || r.to_id === to_id) && (!relation || r.relation === relation)) }),
    ec_rel_add: ({ from_id, relation, to_id, properties }) => {
      if ([...rels.values()].some((r) => r.from_id === from_id && r.relation === relation && r.to_id === to_id)) throw new Error("UNIQUE constraint failed");
      const rel_id = `rel_${(++n).toString(16).padStart(8, "0")}`;
      rels.set(rel_id, { rel_id, from_id, relation, to_id, properties: properties ?? null });
      return { rel_id, from: from_id, relation, to: to_id };
    },
    ec_rel_delete: ({ rel_id }) => { if (!rels.delete(rel_id)) throw new Error(`Relationship not found: '${rel_id}'`); return { status: "deleted", rel_id }; },
    ec_entity_type_list: () => [...types.values()].map((t) => ({ name: t.name, description: t.description, field_count: Object.keys(t.fields).length, entity_count: [...entities.values()].filter((e) => e.type === t.name).length, fields: t.fields })),
    ec_entity_type_define: ({ name, fields, description }) => { types.set(name, { name, fields, description }); return { type_name: name, fields, status: "created" }; },
    ec_entity_create: ({ type, data }) => {
      const t = types.get(type);
      if (!t) throw new Error(`Unknown entity type: '${type}'`);
      for (const [f, spec] of Object.entries(t.fields)) if (spec.required && (data[f] === undefined || data[f] === null)) throw new Error(`Missing required field '${f}'`);
      for (const f of Object.keys(data)) if (!t.fields[f]) throw new Error(`Unknown field '${f}'`);
      const id = `ent_${(++n).toString(16).padStart(8, "0")}`;
      entities.set(id, { entity_id: id, type, data: { ...data }, created_at: now(), updated_at: now() });
      return { entity_id: id, type, data };
    },
    ec_entity_update: ({ entity_id, data }) => {
      const e = entities.get(entity_id);
      if (!e) throw new Error(`Entity not found: '${entity_id}'`);
      Object.assign(e.data, data); n++; e.updated_at = now();
      return { status: "updated", entity_id, data: e.data };
    },
    ec_entity_delete: ({ entity_id }) => { entities.delete(entity_id); return { status: "deleted" }; },
    ec_entity_query: ({ type, limit = 50, offset = 0 }) => {
      if (!types.has(type)) throw new Error(`Unknown entity type: '${type}'`);
      const all = [...entities.values()].filter((e) => e.type === type);
      return { total: all.length, entities: all.slice(offset, offset + limit) };
    },
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-api-key"] !== key) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"unauthorized"}'); return; }
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      let result;
      if (msg.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake-encyclist", version: "0" } };
      else if (msg.method === "tools/list") result = { tools: Object.keys(tools).map((name) => ({ name, inputSchema: { type: "object" } })) };
      else if (msg.method === "tools/call") {
        try { const v = tools[msg.params.name](msg.params.arguments || {}); result = { content: [{ type: "text", text: JSON.stringify(v) }], isError: false }; }
        catch (e) { result = { content: [{ type: "text", text: `Error executing tool ${msg.params.name}: ${e.message}` }], isError: true }; }
      } else result = {};
      const out = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
      if (sse) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`event: message\ndata: ${out}\n\n`); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end(out); }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, key, entities, types, docs, rels, close: () => new Promise((r) => server.close(r)) };
}
