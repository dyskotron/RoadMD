// roadmd serve: the page and the board over HTTP. No dependencies (node:http). The board is read from its storage on
// a visit and kept for a few seconds (so a page and its API calls share one read); ?fresh=1 reads it again.
//
//   GET /              the page (the same file `roadmd build` writes, built from the board as it is now)
//   GET /api/board     the page's data as JSON (items, lists, next, milestones, areas, reviews; no documents)
//   GET /api/next      what can be worked on now, as `roadmd next --json`
//   GET /api/check     { ok, errors, warnings }
//   GET /health        { ok } (no password)
//
// A password (ROADMD_PASSWORD, or the option) puts everything but /health behind HTTP Basic auth, any user name.
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { loadModel, pageData } from "./model.mjs";
import { renderPage } from "./page.mjs";

export function startServer({ configFile, port = 8080, host = "0.0.0.0", password = process.env.ROADMD_PASSWORD || "", cacheMs = 5000, log = console.log }) {
  let cached = null, loading = null;
  async function model(fresh) {
    if (!fresh && cached && Date.now() - cached.at < cacheMs) return cached.m;
    loading ||= loadModel(configFile).then((m) => { cached = { m, at: Date.now() }; return m; }).finally(() => { loading = null; });
    return loading;
  }
  const authorised = (req) => {
    if (!password) return true;
    const h = req.headers.authorization || "";
    if (!h.startsWith("Basic ")) return false;
    const given = Buffer.from(Buffer.from(h.slice(6), "base64").toString("utf8").replace(/^[^:]*:/, ""));
    const want = Buffer.from(password);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const headers = { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (text.length > 1024 && /\bgzip\b/.test(res.req?.headers["accept-encoding"] || "")) {
      res.writeHead(status, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
      return res.end(zlib.gzipSync(text));
    }
    res.writeHead(status, headers);
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const started = Date.now();
    try {
      if (url.pathname === "/health") return send(res, 200, { ok: true, service: "roadmd" });
      if (!authorised(req)) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="roadmd"', "content-type": "text/plain" });
        return res.end("password required");
      }
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "read only (editing comes with step 4b)" });
      const fresh = url.searchParams.has("fresh");
      if (url.pathname === "/") {
        const m = await model(fresh);
        return send(res, 200, renderPage(m, { generated: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", live: { readOnly: true } }), "text/html; charset=utf-8");
      }
      if (url.pathname === "/api/board") { const m = await model(fresh); return send(res, 200, { ok: !m.errors.length, ...pageData(m, new Date().toISOString()) }); }
      if (url.pathname === "/api/check") { const m = await model(fresh); return send(res, 200, { ok: !m.errors.length, errors: m.errors, warnings: m.warnings }); }
      if (url.pathname === "/api/next") { const m = await model(fresh); return send(res, 200, nextJson(m)); }
      return send(res, 404, { ok: false, error: `no ${url.pathname}` });
    } catch (e) {
      log(`error ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      return send(res, 500, { ok: false, error: e.message });
    } finally {
      if (url.pathname !== "/health") log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => { log(`roadmd serving ${configFile} on http://${host}:${server.address().port}${password ? " (password set)" : " (no password)"}`); resolve(server); }));
}

// the same sections as `roadmd next --json`
function nextJson(m) {
  const row = (id) => { const it = m.items[id]; return { id, title: it.title, state: it.state, stateNote: it.stateNote, milestone: it.milestone, immediate: it.immediate, total: it.total, waitingFor: it.waitingFor }; };
  const sections = [];
  for (const entry of m.cfg.overview) {
    if (entry === "reviews") continue;
    if (entry === "inProgress") { sections.push({ id: "doing", title: m.cfg.inProgress.label, items: m.lists.inProgress.map(row) }); continue; }
    if (entry === "next") { for (const n of m.next) { const w = m.works.find((x) => x.id === n.work); sections.push({ id: "next:" + w.id, title: w.next, items: n.ids.map(row) }); } continue; }
    const w = m.works.find((x) => x.id === entry);
    sections.push({ id: w.id, title: w.label, items: m.lists[w.id].map(row) });
    if (w.waiting && m.lists[w.id + ":waiting"].length) sections.push({ id: w.id + ":waiting", title: w.waiting.label, items: m.lists[w.id + ":waiting"].map(row) });
  }
  return { ok: !m.errors.length, sections, open: m.open.length, items: m.all.length };
}
