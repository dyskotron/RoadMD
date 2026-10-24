// The patterns the formats share: IDs, areas, milestones (their shapes come from the config).

export function compilePatterns(cfg) {
  const id = cfg.ids.pattern, area = cfg.areas.pattern, ms = cfg.milestones.pattern;
  return {
    id: new RegExp(`\\b(?:${id})\\b`, "g"),
    idExact: new RegExp(`^(?:${id})$`),
    item: new RegExp(`^- \\*\\*(${id}) (.+?)\\*\\* — (.*)$`),
    itemHeader: new RegExp(`^# (${id}) (.+)$`),
    area: new RegExp(`^### (${area}) — (.+)$`),
    milestone: new RegExp(`^### (${ms}) (.+?)(?: — (.*))?$`),
    wildcard: /\b([A-Z][A-Z0-9]*)-\*/g,
    range: /\b([A-Z][A-Z0-9]*-)(\d+)\s*(?:…|\.\.\.?|–)\s*\1(\d+)\b/g,
    // a line that is only IDs, wildcards and separators: a milestone's item list in the single-file format
    idList: new RegExp(`^(?:(?:${id})|[A-Z][A-Z0-9]*-\\*|[\\s·…,.–]+)+$`),
  };
}

export const splitId = (id) => { const i = id.lastIndexOf("-"); return { feature: id.slice(0, i), stage: +id.slice(i + 1) }; };

export const idsIn = (P, text) => [...text.matchAll(P.id)].map((m) => m[0]);

// FEATURE-n ordered by feature, then stage as a number
export const byId = (a, b) => {
  const x = splitId(a), y = splitId(b);
  return x.feature < y.feature ? -1 : x.feature > y.feature ? 1 : x.stage - y.stage;
};

// "done (accepted by Matej 2026-10-24)" -> { state, note }
export function parseState(text) {
  const m = (text || "").trim().match(/^([a-z][a-z0-9-]*)(?:\s*\((.*)\))?$/);
  return m ? { state: m[1], note: m[2] || "" } : null;
}

// The state a dropped item keeps: outside every project's pipeline, never in the config.
export const DROPPED = "dropped";

// An item as the engine works on it, whatever stores it.
export function newItem(id, title) {
  const { feature, stage } = splitId(id);
  return { id, feature, stage, title, state: "", stateNote: "", area: null, milestone: null, after: [], feeds: [], with: [], parts: [], refs: null, note: [], was: [], order: 0, source: null, line: 0, base: "" };
}
