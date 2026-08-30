/* Reading a PDF in the browser, with no library.

   A PDF statement is the format banks actually email, and until now it was the
   one thing Mizan told people to go and convert themselves. Two ways exist to
   read one:

   1. Pull the text out here. Every e-statement and most invoices are text
      under the ink — the characters are in the file, positioned. Extracting
      them costs nothing, works with no key, feeds the offline parser, and
      turns a twelve-page statement into a few kilobytes of rows instead of
      twelve vision calls.
   2. Hand the file to the model. A scan is pixels; there is no text to find,
      and only a model that can see will read it.

   So this tries (1) and says honestly whether it worked, and the callers fall
   back to (2). The honesty is the important part: a subset-encoded font gives
   back plausible-looking bytes that are not the words on the page, and
   silently sweeping a month of mojibake into someone's ledger is worse than
   spending a vision call. `looksLikeText` is what stands between those.

   No pdf.js: it is over a megabyte for a job that, on text PDFs, is inflate
   plus a content-stream tokenizer. DecompressionStream is in every browser
   this app supports, and in Node, so this is testable. */

const DELIM = "()<>[]{}/%";
const isSpace = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
const isDelim = (c) => DELIM.includes(c);

/* Bytes as one char per byte. Chunked because a 10 MB statement handed to
   String.fromCharCode as one spread argument blows the call stack. */
export function latin1(bytes) {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return out;
}

/* Inflate, keeping whatever came out before anything went wrong.

   A PDF stream is followed by an end-of-line before `endstream`, and writers
   disagree about how much of it belongs to the data — so the bytes handed here
   routinely have a byte or two of tail on them, which DecompressionStream
   treats as a corrupt trailer and throws over. The inflated pages are already
   in hand at that point. Losing an entire statement to its last newline would
   be an absurd way to fail, so the error ends the read rather than voiding
   it. */
async function inflate(bytes) {
  for (const format of ["deflate", "deflate-raw"]) {
    const parts = [];
    let total = 0;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        total += value.length;
      }
    } catch {
      // trailing bytes, or a wrapper this format cannot read at all
    }
    if (total) {
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      return out;
    }
  }
  return null;
}

/* ---------- strings ---------- */

/* (like this), with escapes, balanced inner parens and \ooo octal. */
function readLiteral(s, i) {
  let depth = 1;
  let out = "";
  i++; // past "("
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n >= "0" && n <= "7") {
        let oct = "";
        let j = i + 1;
        while (j < s.length && oct.length < 3 && s[j] >= "0" && s[j] <= "7") oct += s[j++];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i = j;
        continue;
      }
      const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      if (n === "\n") i += 2; // line continuation: the break is not content
      else if (n === "\r") i += s[i + 2] === "\n" ? 3 : 2;
      else { out += map[n] != null ? map[n] : n; i += 2; }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") { depth--; if (!depth) return [out, i + 1]; }
    out += c;
    i++;
  }
  return [out, i];
}

/* <48656c6c6f>, padded with a trailing zero if odd. */
function readHex(s, i) {
  let out = "";
  let hex = "";
  i++; // past "<"
  while (i < s.length && s[i] !== ">") {
    if (/[0-9a-fA-F]/.test(s[i])) hex += s[i];
    i++;
  }
  if (hex.length % 2) hex += "0";
  for (let j = 0; j < hex.length; j += 2) out += String.fromCharCode(parseInt(hex.slice(j, j + 2), 16));
  return [out, i + 1];
}

/* PDF strings are bytes; what they mean depends on the font's encoding. The
   two cases worth handling are the two that turn up: a UTF-16BE string (marked
   by a BOM, or unmistakable from its alternating zero bytes) and everything
   else, which is close enough to Latin-1 to read. */
export function decodeString(raw) {
  const asUtf16 = (from) => {
    let out = "";
    for (let i = from; i + 1 < raw.length; i += 2) out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
    return out;
  };
  if (raw.length >= 2 && raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) return asUtf16(2);
  if (raw.length >= 4 && raw.length % 2 === 0) {
    let zeros = 0;
    for (let i = 0; i < raw.length; i += 2) if (raw.charCodeAt(i) === 0) zeros++;
    if (zeros === raw.length / 2) return asUtf16(0);
  }
  return raw;
}

/* ---------- fonts ----------

   The one thing that decides whether a modern PDF is readable at all.

   A file printed from a browser, or written by anything that had to draw
   Arabic, embeds a subset font addressed by glyph number: the bytes in the
   string are 0x0024, 0x0037, and what those glyphs *look like* lives in the
   font program. Read them as characters and you get fluent-looking nonsense.

   What saves it is the ToUnicode CMap the same writers embed for copy-paste:
   a table from those codes back to real characters. Follow the page's font
   resources to it and the same file reads perfectly; miss it and every
   statement generated in the last decade goes to a vision call. */

/* <src> <dst> pairs and <lo> <hi> <dst> ranges, as a code -> string map. */
export function parseCMap(text) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const chars = (h) => {
    let out = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out || String.fromCharCode(hex(h));
  };
  let width = 0;

  for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      width = Math.max(width, m[1].length);
      map.set(hex(m[1]), chars(m[2]));
    }
  }
  for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
    // <lo> <hi> [<a> <b> <c>]
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g)) {
      width = Math.max(width, m[1].length);
      const dsts = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((d) => chars(d[1]));
      const lo = hex(m[1]);
      dsts.forEach((d, k) => map.set(lo + k, d));
    }
    // <lo> <hi> <dst>, the destination walking up with the code
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      width = Math.max(width, m[1].length);
      const lo = hex(m[1]);
      const hi = hex(m[2]);
      const base = m[3];
      if (hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c++) {
        const shifted = (parseInt(base.slice(-4), 16) + (c - lo)) & 0xffff;
        map.set(c, base.length > 4 ? chars(base.slice(0, -4)) + String.fromCharCode(shifted) : String.fromCharCode(shifted));
      }
    }
  }
  return { map, bytes: width > 2 ? 2 : 1 };
}

/* A string drawn in a font whose codes have been mapped. An unmapped code
   becomes U+FFFD rather than a guess — it is what makes a half-read page fail
   looksLikeText instead of quietly landing in someone's ledger. */
function viaFont(font, raw) {
  if (!font || !font.map || !font.map.size) return decodeString(raw);
  let out = "";
  const step = font.bytes;
  for (let i = 0; i + step - 1 < raw.length; i += step) {
    const code = step === 2 ? (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1) : raw.charCodeAt(i);
    const got = font.map.get(code);
    out += got == null ? "�" : got;
  }
  return out;
}

/* ---------- content streams ---------- */

/* Turn a page's drawing instructions back into lines of text.

   Text in a PDF is positioned, not flowed: nothing in the file says where a
   row ends, or even where a word does. What it does say is where every run is
   drawn, so the geometry has to answer both questions. A run below the last
   one starts a new line. A run to the right of where the last one ended, by
   more than a fraction of the type size, has a gap between them and gets a
   space; a run that carries straight on does not — which matters, because
   plenty of writers emit one glyph per operator, and a space between each of
   them would turn a statement into "2 8 D e c". */

/* How wide the last run was, so the gap after it can be measured. The real
   widths are in the font program, which is not worth unpacking for this: an m
   is wide, an l is thin, and being roughly right about that is the difference
   between "Announcement" and "Announcem ent". */
const charWidth = (ch) => {
  if ("iljItf.,;:'!|()[]-".includes(ch)) return 0.3;
  if ("mwMW@%".includes(ch)) return 0.85;
  if (ch >= "A" && ch <= "Z") return 0.66;
  if (ch >= "0" && ch <= "9") return 0.55;
  return 0.5;
};
const widthOf = (s) => {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
};
export function textFromContent(s, fonts) {
  const lines = [];
  let line = "";
  let stack = []; // operands, with "[" markers kept in place for TJ
  let x = 0;
  let y = null;
  let endX = 0;   // where the last thing drawn finished, roughly
  let lineX = 0;  // where the current line started, for T*
  let size = 10;
  let leading = 0;
  let font = null; // whichever /F the last Tf selected, with its cmap

  const breakLine = () => { if (line.trim()) lines.push(line.trim()); line = ""; };
  const show = (str) => {
    if (!str) return;
    line += str;
    endX = x + widthOf(str) * size;
  };
  const moveTo = (nx, ny) => {
    if (y != null && Math.abs(ny - y) > 0.6) breakLine();
    else if (line && !line.endsWith(" ") && nx - endX > 0.28 * size) line += " ";
    x = nx;
    y = ny;
    endX = nx;
  };
  const nums = () => stack.filter((o) => o.t === "num").map((o) => o.v);

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "%") { while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === "(") { const [v, j] = readLiteral(s, i); stack.push({ t: "s", v: viaFont(font, v) }); i = j; continue; }
    if (c === "<") {
      if (s[i + 1] === "<") { stack.push({ t: "dict" }); i += 2; continue; }
      const [v, j] = readHex(s, i);
      stack.push({ t: "s", v: viaFont(font, v) });
      i = j;
      continue;
    }
    if (c === ">") { i += s[i + 1] === ">" ? 2 : 1; continue; }
    if (c === "[") { stack.push({ t: "arr" }); i++; continue; }
    if (c === "]" || c === "{" || c === "}") { i++; continue; }
    if (c === "/") {
      let j = i + 1;
      while (j < s.length && !isSpace(s[j]) && !isDelim(s[j])) j++;
      stack.push({ t: "name", v: s.slice(i + 1, j) });
      i = j;
      continue;
    }

    let j = i;
    while (j < s.length && !isSpace(s[j]) && !isDelim(s[j])) j++;
    const tok = s.slice(i, j);
    i = j === i ? i + 1 : j;

    if (/^[-+.\d]/.test(tok) && !isNaN(parseFloat(tok))) { stack.push({ t: "num", v: parseFloat(tok) }); continue; }

    switch (tok) {
      case "Tj":
      case "'":
      case '"': {
        if (tok !== "Tj") { breakLine(); if (y != null) y -= leading; x = lineX; endX = lineX; }
        const last = [...stack].reverse().find((o) => o.t === "s");
        show(last && last.v);
        break;
      }
      case "TJ": {
        const start = stack.map((o) => o.t).lastIndexOf("arr");
        const items = start >= 0 ? stack.slice(start + 1) : stack;
        let out = "";
        for (const it of items) {
          if (it.t === "s") out += it.v;
          // a big negative kern is how a PDF draws a gap between two runs;
          // small ones are just letter-spacing inside a word
          else if (it.t === "num" && it.v < -170) out += " ";
        }
        show(out);
        break;
      }
      case "Td":
      case "TD": {
        const n = nums();
        if (n.length >= 2) {
          const tx = n[n.length - 2];
          const ty = n[n.length - 1];
          if (tok === "TD") leading = -ty;
          moveTo(x + tx, (y == null ? 0 : y) + ty);
          lineX = x;
        }
        break;
      }
      case "Tm": {
        const n = nums();
        if (n.length >= 6) { moveTo(n[4], n[5]); lineX = n[4]; }
        break;
      }
      case "Tf": {
        const nm = stack.find((o) => o.t === "name");
        const n = nums();
        if (n.length) size = Math.abs(n[n.length - 1]) || size;
        font = fonts && nm ? fonts[nm.v] || null : null;
        break;
      }
      case "TL": { const n = nums(); if (n.length) leading = n[n.length - 1]; break; }
      case "T*": { breakLine(); if (y != null) y -= leading; x = lineX; endX = lineX; break; }
      case "ET":
      case "BT": breakLine(); break;
      default: break;
    }
    stack = [];
  }
  breakLine();
  return lines.join("\n");
}

/* ---------- the file ----------

   Enough of the object graph to answer one question: for each page, which
   streams draw its text and which fonts do they draw it in. That is a smaller
   job than parsing PDF properly — no xref table is read, objects are found by
   scanning for "N 0 obj" — and it is the whole job, because a font resource
   is looked up by a name that only means anything inside its own page. */

/* Reading is fast, but a thousand-page file is neither a statement nor a
   receipt, and inflating it would lock the tab up for half a minute. Past this
   the read stops and says how far it got, so nothing silently arrives as a
   ledger missing its last eleven months. */
const MAX_PAGES = 120;

/* Streams that are pictures or font programs: no text in them either way. */
const SKIP = /\/(Subtype\s*\/Image|DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|FontFile\d?|Length1)/;

/* Every "N 0 obj … endobj" in the file, keyed by object number.
   Stream bodies are kept as offsets so nothing large is copied twice. */
function parseObjects(raw) {
  const objs = new Map();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(raw))) {
    const num = parseInt(m[1], 10);
    const bodyStart = m.index + m[0].length;
    /* The dictionary ends at this object's own "endobj", and the search for a
       stream keyword has to stop there too — otherwise a plain dictionary
       followed by an image object adopts the image's stream, and everything
       between them is skipped. */
    const stop = raw.indexOf("endobj", bodyStart);
    const head = raw.slice(bodyStart, stop < 0 ? bodyStart + 8000 : stop);
    const sm = /stream\r\n|stream\n|stream\r/.exec(head);
    if (!sm) {
      objs.set(num, { dict: head, dataStart: -1 });
      if (stop > 0) re.lastIndex = stop + 6;
      continue;
    }

    const dict = head.slice(0, sm.index);
    const dataStart = bodyStart + sm.index + sm[0].length;
    /* Prefer the declared length: binary data can contain the word
       "endstream" as readily as any other eight bytes. */
    let dataEnd = -1;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (len) {
      const cand = dataStart + parseInt(len[1], 10);
      if (cand <= raw.length && raw.slice(cand, cand + 20).includes("endstream")) dataEnd = cand;
    }
    if (dataEnd < 0) dataEnd = raw.indexOf("endstream", dataStart);
    if (dataEnd < 0) dataEnd = dataStart;
    objs.set(num, { dict, dataStart, dataEnd });
    // over the binary: it can contain anything, including "12 0 obj"
    re.lastIndex = dataEnd + 9;
  }
  return objs;
}

async function streamOf(obj, raw, u8) {
  if (!obj || obj.dataStart < 0 || obj.dataEnd <= obj.dataStart) return null;
  const body = u8.subarray(obj.dataStart, obj.dataEnd);
  if (/\/FlateDecode/.test(obj.dict)) {
    const out = await inflate(body);
    return out ? latin1(out) : null;
  }
  if (/\/Filter/.test(obj.dict)) return null; // LZW, RunLength: rare enough to punt to the model
  return latin1(body);
}

/* PDF 1.5 keeps most non-stream objects — page dicts and font dicts included —
   packed inside compressed object streams. Without unpacking them, a modern
   file looks like it has no pages at all. */
async function expandObjectStreams(objs, raw, u8) {
  for (const [, obj] of [...objs]) {
    if (obj.dataStart < 0 || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const content = await streamOf(obj, raw, u8);
    if (!content) continue;
    const n = parseInt((obj.dict.match(/\/N\s+(\d+)/) || [])[1], 10);
    const first = parseInt((obj.dict.match(/\/First\s+(\d+)/) || [])[1], 10);
    if (!Number.isFinite(n) || !Number.isFinite(first)) continue;
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(off) || objs.has(num)) continue;
      const nextOff = i + 1 < n ? header[i * 2 + 3] : content.length - first;
      objs.set(num, { dict: content.slice(first + off, first + (Number.isFinite(nextOff) ? nextOff : content.length)), dataStart: -1 });
    }
  }
}

/* The balanced << … >> starting at `at`, so a nested dictionary does not end
   the outer one at its first ">>". */
function dictAt(s, at) {
  let depth = 0;
  for (let i = at; i < s.length - 1; i++) {
    if (s[i] === "<" && s[i + 1] === "<") { depth++; i++; }
    else if (s[i] === ">" && s[i + 1] === ">") { depth--; i++; if (!depth) return s.slice(at, i + 1); }
  }
  return s.slice(at, at + 4000);
}

/* A key's value as either the dictionary written in place or the one the
   reference points at. */
function entry(dict, key, objs) {
  const m = new RegExp("/" + key + "\\s*(\\d+)\\s+\\d+\\s+R").exec(dict);
  if (m) {
    const target = objs.get(parseInt(m[1], 10));
    return target ? target.dict : "";
  }
  const at = new RegExp("/" + key + "\\s*<<").exec(dict);
  return at ? dictAt(dict, at.index + at[0].length - 2) : "";
}

function refsFor(dict, key) {
  const one = new RegExp("/" + key + "\\s*(\\d+)\\s+\\d+\\s+R").exec(dict);
  if (one) return [parseInt(one[1], 10)];
  const arr = new RegExp("/" + key + "\\s*\\[([^\\]]*)\\]").exec(dict);
  if (arr) return [...arr[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10));
  return [];
}

/* { F1: {map, bytes}, … } for one page's font resources. */
async function fontsFor(pageDict, objs, raw, u8, cache) {
  const res = entry(pageDict, "Resources", objs);
  const fontDict = entry(res, "Font", objs);
  const out = {};
  for (const m of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
    const num = parseInt(m[2], 10);
    if (!cache.has(num)) {
      const font = objs.get(num);
      let parsed = null;
      const uni = font ? refsFor(font.dict, "ToUnicode")[0] : null;
      if (uni != null) {
        const cmapText = await streamOf(objs.get(uni), raw, u8);
        if (cmapText) {
          parsed = parseCMap(cmapText);
          // a Type0 font addresses glyphs two bytes at a time whatever the
          // CMap's own entries happen to look like
          if (font && /\/Subtype\s*\/Type0/.test(font.dict)) parsed.bytes = 2;
        }
      }
      cache.set(num, parsed);
    }
    const got = cache.get(num);
    if (got) out[m[1]] = got;
  }
  return out;
}

/* Does this read like a document, or like the inside of a font?

   A subset font with a custom encoding decodes to bytes that are perfectly
   valid characters and completely wrong words. Nothing in the file admits to
   it, so the test has to be on the output: real text is overwhelmingly
   printable, and a financial document has numbers and words in it. */
/* Arabic in a PDF is usually stored in the order it is *drawn*, right to left,
   because the writer already did the shaping. Pulled out as characters it
   comes back mirrored — بداية as ةيادب — and a merchant name spelled backwards
   in a ledger is not a small cosmetic problem. Nothing in the file says which
   order was used, so any real amount of Arabic sends the file to a model,
   which reads the page as it looks. */
export function looksReversed(s) {
  let arabic = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x600 && c <= 0x6ff) || (c >= 0xfb50 && c <= 0xfeff)) arabic++;
    if (arabic >= 12) return true;
  }
  return false;
}

export function looksLikeText(s) {
  const t = (s || "").trim();
  if (t.length < 24) return false;
  if (!/\d/.test(t)) return false;
  let good = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const ok =
      (c >= 32 && c <= 126) || c === 10 || c === 13 || c === 9 ||
      (c >= 0x600 && c <= 0x6ff) || (c >= 0xfe70 && c <= 0xfeff) || // Arabic
      (c >= 0xa0 && c <= 0x24f); // Latin-1 supplement + extended
    if (ok) good++;
  }
  if (good / t.length < 0.85) return false;
  // a run of letters somewhere: pure punctuation and digits is a layout dump
  return /[A-Za-z؀-ۿ]{3}/.test(t);
}

/* The object walk, for tests and for working out why a particular file did
   not read. Not part of what the app calls. */
export const internals = { parseObjects, expandObjectStreams, streamOf, entry, refsFor, fontsFor };

/* { ok, text, pages, reason } — ok:false means "send the file to a model".

   Never throws: a PDF this cannot read is a routing decision, not an error
   anyone needs to be shown. */
export async function extractPdfText(bytes) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const raw = latin1(u8);
    if (!raw.startsWith("%PDF")) return { ok: false, text: "", pages: 0, reason: "not-pdf" };
    if (/\/Encrypt[\s\d</]/.test(raw)) return { ok: false, text: "", pages: 0, reason: "encrypted" };

    const objs = parseObjects(raw);
    await expandObjectStreams(objs, raw, u8);

    const pageObjs = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page[^s]/.test(o.dict + " "));
    const cache = new Map(); // font object -> its CMap, parsed once per file
    const chunks = [];

    if (pageObjs.length) {
      for (const [, page] of pageObjs.slice(0, MAX_PAGES)) {
        const fonts = await fontsFor(page.dict, objs, raw, u8, cache);
        for (const ref of refsFor(page.dict, "Contents")) {
          const obj = objs.get(ref);
          if (!obj || SKIP.test(obj.dict)) continue;
          const content = await streamOf(obj, raw, u8);
          if (content) chunks.push(textFromContent(content, fonts));
        }
      }
    }

    /* A file whose pages could not be followed — a damaged xref, an unusual
       writer — still usually has its content streams sitting there in plain
       sight. Reading them without the font tables is worse (a subset font
       comes out as nonsense and gets rejected below), but it is the difference
       between reading a slightly odd file and refusing it. */
    if (!chunks.join("").trim()) {
      for (const [, obj] of objs) {
        if (obj.dataStart < 0 || SKIP.test(obj.dict) || /\/Type\s*\/(ObjStm|XRef|Metadata)/.test(obj.dict)) continue;
        const content = await streamOf(obj, raw, u8);
        if (content && (content.includes("BT") || /\bT[Jj]\b/.test(content))) chunks.push(textFromContent(content));
        if (chunks.length > 2000) break;
      }
    }

    const pages = pageObjs.length || (() => {
      const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10));
      return counts.length ? Math.max(...counts) : 0;
    })();

    const text = chunks.filter(Boolean).join("\n").trim();
    if (!looksLikeText(text)) return { ok: false, text: "", pages, reason: text ? "unreadable-encoding" : "no-text-layer" };
    if (looksReversed(text)) return { ok: false, text: "", pages, reason: "bidi" };
    return { ok: true, text, pages, reason: null, truncated: pages > MAX_PAGES ? MAX_PAGES : 0 };
  } catch (e) {
    return { ok: false, text: "", pages: 0, reason: (e && e.message) || "failed" };
  }
}
