/* AI provider abstraction.

   aiComplete(spec, cfg) -> string of model output text
     spec: { prompt, system?, image?: { media, data }, search?: boolean }
     cfg:  { geminiKey?, geminiModel? }

   Routing: if a Gemini API key is configured (Settings page), calls the Gemini
   API directly from the browser — Google's generativelanguage endpoint allows
   browser CORS with key auth. Otherwise falls back to the Anthropic messages
   endpoint, which is auto-authenticated only inside Claude.ai artifacts.
   The key never leaves the browser except to Google's API. */

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

async function geminiCall({ prompt, system, image, search }, cfg) {
  const key = (cfg.geminiKey || "").trim();
  if (!key) throw new Error("no-key");
  const model = cfg.geminiModel || DEFAULT_GEMINI_MODEL;
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.media, data: image.data } });
  parts.push({ text: prompt });
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (search) body.tools = [{ google_search: {} }];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "gemini-error");
  const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
    .map((p) => p.text || "")
    .join("");
  if (!text) throw new Error("empty-response");
  return text;
}

async function anthropicCall({ prompt, system, image, search }) {
  const endpoint = (typeof window !== "undefined" && window.MIZAN_API) || "https://api.anthropic.com/v1/messages";
  let content;
  if (image)
    content = [
      { type: "image", source: { type: "base64", media_type: image.media, data: image.data } },
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

/* quick key check for the Settings page */
export async function testGeminiKey(key, model) {
  try {
    const text = await geminiCall({ prompt: "Reply with exactly: OK" }, { geminiKey: key, geminiModel: model });
    return /ok/i.test(text) ? { ok: true } : { ok: true, note: "responded, unexpected text" };
  } catch (e) {
    return { ok: false, error: e.message || "failed" };
  }
}
