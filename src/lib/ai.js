/* AI provider abstraction.

   aiComplete(spec, cfg) -> string of model output text
     spec: { prompt, system?, image?, files?, search?: boolean }
       image — one { media, data }, kept because most callers send one thing
       files — several of the same, in order: receipt photos, statement pages,
               or a PDF that had no text to extract (media application/pdf).
               Both providers read PDFs natively, so a scan does not have to be
               turned into images first.
     cfg:  { geminiKey?, geminiModel? }   // geminiModel "auto" = resolve best Flash

   Routing: if a Gemini API key is configured (Settings page), calls the Gemini
   API directly from the browser. Otherwise falls back to the Anthropic messages
   endpoint, which is auto-authenticated only inside Claude.ai artifacts.
   The key never leaves the browser except to Google's API.

   Model resilience: Google renames and retires model IDs, so pinning one is a
   time bomb. In "auto" mode we ask ListModels which Flash models this key can
   actually use and pick the best; on model-not-found or quota errors we fall
   through a candidate chain instead of failing the user. A manually chosen
   model gets the same safety net. */

export const DEFAULT_GEMINI_MODEL = "auto";
export const GEMINI_MODELS = [
  "auto",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

/* static safety net when ListModels itself is unreachable — rolling aliases
   first (Google keeps these pointed at the newest Flash), then pinned IDs */
const FALLBACK_CHAIN = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/* Where this call goes, and what it presents as its key. */
function route(cfg) {
  return { base: GEMINI_BASE, key: (cfg.geminiKey || "").trim() };
}

let resolvedCache = null; // { key, candidates: [...] }
let lastUsed = null;      // model name that served the most recent success

/* ask the API which text-capable Flash models this key can use, best first */
async function listFlashModels(key, base = GEMINI_BASE) {
  const res = await fetch(`${base}/models?key=${encodeURIComponent(key)}&pageSize=200`);
  const data = await res.json();
  if (data.error || !Array.isArray(data.models)) throw new Error((data.error && data.error.message) || "list-failed");
  const usable = data.models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => (m.name || "").replace(/^models\//, ""))
    .filter((n) => n.includes("flash"));
  // avoid special-purpose variants that can't do plain text well
  const clean = usable.filter((n) => !/(image|audio|tts|live|native|exp|thinking|embedding)/.test(n));
  const pool = clean.length ? clean : usable;
  if (!pool.length) throw new Error("no-flash-models");
  const score = (n) => {
    let s = 0;
    if (n === "gemini-flash-latest") s += 1000;      // rolling alias: always current
    if (n === "gemini-flash-lite-latest") s += 900;
    const v = n.match(/(\d+)\.(\d+)/);
    if (v) s += parseInt(v[1], 10) * 100 + parseInt(v[2], 10) * 10;
    if (!n.includes("lite")) s += 5;                  // full flash over lite at same version
    if (n.endsWith("-latest")) s += 3;
    return s;
  };
  return [...new Set(pool)].sort((a, b) => score(b) - score(a));
}

async function resolveCandidates(key, base = GEMINI_BASE) {
  if (resolvedCache && resolvedCache.key === key) return resolvedCache.candidates;
  let candidates;
  try {
    candidates = await listFlashModels(key, base);
  } catch {
    candidates = FALLBACK_CHAIN.slice();
  }
  resolvedCache = { key, candidates };
  return candidates;
}

/* errors worth falling through on: bad/retired model IDs and quota exhaustion
   (a lite model often still has free-tier quota when flash is exhausted) */
function isFallthroughError(status, err) {
  if (status === 404 || status === 429) return true;
  const msg = ((err && err.message) || "").toLowerCase();
  return /not found|not supported|deprecated|resource_exhausted|quota/.test(msg);
}

async function geminiRequest(model, body, key, base = GEMINI_BASE) {
  const res = await fetch(
    `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (data.error) {
    const e = new Error(data.error.message || "gemini-error");
    e.status = res.status || data.error.code;
    throw e;
  }
  const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
    .filter((p) => p.thought !== true) // 2.5 models can emit reasoning parts; keep only the answer
    .map((p) => p.text || "")
    .join("");
  if (!text) throw new Error("empty-response");
  return text;
}

/* Search grounding is its own failure class: free-tier keys and lite models
   frequently can't use the google_search tool (400 INVALID_ARGUMENT /
   "Search Grounding is not supported"). That shouldn't kill the request —
   the right retry is the same model without the tool. */
function isGroundingError(err) {
  const msg = ((err && err.message) || "").toLowerCase();
  return /grounding|google_search|search tool|tool is not supported|tools? (is|are) not (supported|enabled)/.test(msg);
}

/* One or many, one shape. `image` is the single-attachment spelling every
   caller started with; `files` is the same thing for a stack of receipts. */
export function attachmentsOf(spec) {
  const list = [];
  if (spec.image) list.push(spec.image);
  if (Array.isArray(spec.files)) list.push(...spec.files.filter(Boolean));
  return list.filter((f) => f && f.data);
}

const isPdfPart = (f) => /pdf/i.test(f.media || "");

async function geminiCall({ prompt, system, image, files, search }, cfg) {
  const { base, key } = route(cfg);
  if (!key) throw new Error("no-key");
  const parts = [];
  // attachments before the instruction: the prompt refers to them, and a model
  // that has already seen the pages reads the instruction against them
  for (const f of attachmentsOf({ image, files })) parts.push({ inline_data: { mime_type: f.media, data: f.data } });
  parts.push({ text: prompt });
  const makeBody = (useSearch) => {
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (useSearch) body.tools = [{ google_search: {} }];
    return body;
  };

  // build the try-order: chosen model first (unless auto), then resolved candidates
  const resolved = await resolveCandidates(key, base);
  const chosen = cfg.geminiModel && cfg.geminiModel !== "auto" ? cfg.geminiModel : null;
  const order = [...new Set([...(chosen ? [chosen] : []), ...resolved, ...FALLBACK_CHAIN])].slice(0, 5);

  let searchOk = !!search; // once grounding proves unavailable, stop asking for it
  let lastErr;
  for (const model of order) {
    try {
      const text = await geminiRequest(model, makeBody(searchOk), key, base);
      lastUsed = model;
      return text;
    } catch (e) {
      lastErr = e;
      if (searchOk && isGroundingError(e)) {
        // retry this same model tool-free before walking down the chain
        searchOk = false;
        try {
          const text = await geminiRequest(model, makeBody(false), key, base);
          lastUsed = model;
          return text;
        } catch (e2) {
          lastErr = e2;
          if (!isFallthroughError(e2.status, e2)) throw e2;
        }
      } else if (!isFallthroughError(e.status, e)) {
        throw e; // auth errors, bad requests: fail loud
      }
      // a resolved candidate that 404s means our cache is stale — drop it
      if (resolvedCache && resolvedCache.key === key) {
        resolvedCache = { key, candidates: resolvedCache.candidates.filter((m) => m !== model) };
        if (!resolvedCache.candidates.length) resolvedCache = null;
      }
    }
  }
  throw lastErr || new Error("gemini-unavailable");
}

async function anthropicCall({ prompt, system, image, files, search }) {
  const endpoint = (typeof window !== "undefined" && window.MIZAN_API) || "https://api.anthropic.com/v1/messages";
  const attached = attachmentsOf({ image, files });
  let content;
  if (attached.length)
    content = [
      // a PDF is a document block here rather than an image one — that is what
      // lets the model read a text statement as text instead of as pictures
      ...attached.map((f) =>
        isPdfPart(f)
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
          : { type: "image", source: { type: "base64", media_type: f.media, data: f.data } }
      ),
      { type: "text", text: prompt },
    ];
  else content = prompt;
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content }],
  };
  if (system) body.system = system;
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "anthropic-error");
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function aiComplete(spec, cfg = {}) {
  if (cfg.geminiKey && cfg.geminiKey.trim()) return geminiCall(spec, cfg);
  return anthropicCall(spec);
}

/* which provider would handle a call right now — for UI messaging */
export function aiProviderName(cfg = {}) {
  return cfg.geminiKey && cfg.geminiKey.trim() ? "Gemini" : "Claude";
}

/* quick key check for the Settings page — reports the model that answered */
export async function testGeminiKey(key, model) {
  try {
    const text = await geminiCall({ prompt: "Reply with exactly: OK" }, { geminiKey: key, geminiModel: model || "auto" });
    return { ok: /ok/i.test(text), model: lastUsed, note: /ok/i.test(text) ? undefined : "responded, unexpected text" };
  } catch (e) {
    return { ok: false, error: e.message || "failed" };
  }
}
