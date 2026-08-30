/* Anything dropped, picked or shared into Mizan, normalised.

   Three kinds arrive and only three matter downstream:

     image  — send it to a model that can see
     text   — send the characters; no vision call, and the offline parser can
              read it too
     doc    — a PDF whose text could not be recovered here, so the bytes go to
              the model as a document

   A PDF is not a kind of its own on the way out: it is *routed*. If the text
   layer comes out clean (pdf.js), a twelve-page statement becomes a few
   kilobytes of rows — cheaper, faster, and readable with no key at all. If it
   is a scan, the file itself goes up. Callers get one shape either way and do
   not have to know which happened, except to say so in the UI. */

import { extractPdfText } from "./pdf.js";

/* Inline data is base64 inside a JSON request body: about 4/3 of the file, and
   both providers cap the whole request. Keep a wide margin under it — the
   prompt, the account list and the other attachments share the envelope. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_FILES = 12;

const IMAGE_TYPES = /^image\/(jpeg|jpg|png|gif|webp|heic|heif)$/i;
const TEXT_EXT = /\.(csv|txt|tsv|md|log)$/i;

export const isPdf = (f) => /pdf$/i.test(f.type || "") || /\.pdf$/i.test(f.name || "");
export const isImage = (f) => IMAGE_TYPES.test(f.type || "") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name || "");
export const isTextish = (f) => /csv|text|json/i.test(f.type || "") || TEXT_EXT.test(f.name || "");

const readAs = (file, how) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read-failed"));
    r.onload = () => resolve(r.result);
    how === "text" ? r.readAsText(file) : how === "buffer" ? r.readAsArrayBuffer(file) : r.readAsDataURL(file);
  });

export async function toBase64(blob) {
  const url = String(await readAs(blob, "url"));
  const m = /^data:(.*?);base64,(.*)$/.exec(url);
  if (!m) throw new Error("not-base64");
  return { media: m[1] || blob.type || "application/octet-stream", data: m[2] };
}

export function prettySize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/* One file in, one attachment out:

     { kind: "image"|"text"|"doc", name, size, file?, text?, pages?, note? }

   `file` is { media, data } — exactly what ai.js puts in a request part.
   `note` is the one sentence the UI should show about how this was read; it
   exists because "your PDF had no text layer so it is going to the model as
   pictures" changes what the person should expect, and hiding that makes a
   slow, key-requiring path look like a broken one.

   Throws only for a file that cannot be used at all. */
export async function readAttachment(file) {
  const name = file.name || "file";
  const size = file.size || 0;
  if (size > MAX_FILE_BYTES) throw Object.assign(new Error("too-big"), { name, size });

  if (isPdf(file)) {
    const buf = await readAs(file, "buffer");
    const got = await extractPdfText(new Uint8Array(buf));
    if (got.ok) {
      return {
        kind: "text",
        name,
        size,
        text: got.text,
        pages: got.pages,
        note: got.truncated
          ? `PDF · text read here, first ${got.truncated} of ${got.pages} pages`
          : got.pages > 1
          ? `PDF · text read here, ${got.pages} pages`
          : "PDF · text read here",
      };
    }
    return {
      kind: "doc",
      name,
      size,
      pages: got.pages,
      file: await toBase64(file),
      note:
        got.reason === "encrypted"
          ? "PDF · password-protected, so the model reads the file"
          : got.reason === "bidi"
          ? "PDF · Arabic, so the model reads the pages as they look"
          : "PDF · scanned, so the model reads it as pages",
    };
  }

  if (isImage(file)) return { kind: "image", name, size, file: await toBase64(file) };

  if (isTextish(file)) return { kind: "text", name, size, text: String(await readAs(file, "text")) };

  throw Object.assign(new Error("unsupported"), { name, size });
}

/* A picked FileList, in order, with everything that could not be read
   reported rather than dropped. */
export async function readAttachments(files, existingBytes = 0) {
  const list = [...(files || [])];
  const out = [];
  const rejected = [];
  let bytes = existingBytes;

  for (const f of list) {
    if (out.length >= MAX_FILES) { rejected.push({ name: f.name, why: "too-many" }); continue; }
    if (bytes + (f.size || 0) > MAX_TOTAL_BYTES) { rejected.push({ name: f.name, why: "too-big" }); continue; }
    try {
      out.push(await readAttachment(f));
      bytes += f.size || 0;
    } catch (e) {
      rejected.push({ name: f.name || "file", why: (e && e.message) || "unsupported" });
    }
  }
  return { attachments: out, rejected, bytes };
}

/* Why some files were refused, in one sentence, or null. */
export function rejectionMessage(rejected) {
  if (!rejected || !rejected.length) return null;
  const names = rejected.map((r) => r.name).join(", ");
  const why = rejected[0].why;
  if (why === "too-big") return `${names} is too large — ${prettySize(MAX_FILE_BYTES)} per file. Split it, or export the pages you need.`;
  if (why === "too-many") return `Only ${MAX_FILES} files at a time — ${names} did not make it in.`;
  return `Couldn't use ${names}. Images, PDFs and CSV/text exports work.`;
}

/* The attachment list as the parts and prose an AI call takes:
   { files: [{media,data}], docText } — docText being everything that was
   readable as characters, labelled so the model knows what it is looking at. */
export function toAiInput(attachments) {
  const list = attachments || [];
  const files = list.filter((a) => a.file).map((a) => a.file);
  const texts = list
    .filter((a) => a.kind === "text" && a.text)
    .map((a) => `--- ${a.name} ---\n${a.text.slice(0, 24000)}`);
  return { files, docText: texts.length ? texts.join("\n\n") : null };
}
