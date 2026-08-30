/* The webhook reads whatever Telegram decided to send, and Telegram sends the
   same intent in several shapes: a photo is a ladder of sizes, an image can
   arrive as a document instead, and a caption sits in a different field from a
   message. Getting this wrong loses a capture silently — the bot answers
   "saved" and nothing is there — so the shapes are pinned here. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readUpdate, newCode } from "../api/_inbox.js";

const msg = (over = {}) => ({ message: { chat: { id: 4242 }, ...over } });

test("a plain note is captured as text", () => {
  const u = readUpdate(msg({ text: "80 uber" }));
  assert.equal(u.kind, "text");
  assert.equal(u.text, "80 uber");
  assert.equal(u.chatId, "4242");
});

test("a photo takes the largest size offered", () => {
  const u = readUpdate(msg({
    photo: [
      { file_id: "small", width: 90 },
      { file_id: "medium", width: 320 },
      { file_id: "large", width: 1280 },
    ],
  }));
  assert.equal(u.kind, "photo");
  assert.equal(u.fileId, "large");
});

test("a caption travels with its photo", () => {
  const u = readUpdate(msg({ photo: [{ file_id: "x" }], caption: "groceries, paid by card" }));
  assert.equal(u.kind, "photo");
  assert.equal(u.text, "groceries, paid by card");
});

test("an image sent as a document is still a receipt", () => {
  const u = readUpdate(msg({ document: { file_id: "doc1", mime_type: "image/jpeg" } }));
  assert.equal(u.kind, "photo");
  assert.equal(u.fileId, "doc1");
});

test("a forwarded PDF invoice is captured, not ignored", () => {
  const u = readUpdate(msg({ document: { file_id: "d", mime_type: "application/pdf" } }));
  assert.equal(u.kind, "photo");
  assert.equal(u.fileId, "d");
});

test("a document that is neither is ignored rather than captured as empty", () => {
  const u = readUpdate(msg({ document: { file_id: "d", mime_type: "application/zip" } }));
  assert.equal(u.kind, "ignored");
});

test("/start carries the linking code, with or without a bot suffix", () => {
  assert.deepEqual(
    { kind: readUpdate(msg({ text: "/start K7M2Q9AB" })).kind, code: readUpdate(msg({ text: "/start K7M2Q9AB" })).code },
    { kind: "start", code: "K7M2Q9AB" }
  );
  assert.equal(readUpdate(msg({ text: "/start@MizanBot K7M2Q9AB" })).code, "K7M2Q9AB");
  assert.equal(readUpdate(msg({ text: "/start" })).code, "", "a bare /start asks for a code rather than failing");
});

test("commands are not filed as expenses", () => {
  assert.equal(readUpdate(msg({ text: "/help" })).kind, "help");
  assert.equal(readUpdate(msg({ text: "/stop" })).kind, "stop");
});

test("an edited message is still a capture", () => {
  const u = readUpdate({ edited_message: { chat: { id: 7 }, text: "120 lunch" } });
  assert.equal(u.kind, "text");
  assert.equal(u.text, "120 lunch");
});

test("junk updates do not throw", () => {
  assert.equal(readUpdate(null), null);
  assert.equal(readUpdate({}), null);
  assert.equal(readUpdate({ message: {} }), null);
  assert.equal(readUpdate(msg({})).kind, "ignored");
});

test("link codes avoid characters that are misread aloud", () => {
  const codes = Array.from({ length: 40 }, () => newCode());
  assert.ok(codes.every((c) => c.length === 8));
  assert.ok(codes.every((c) => !/[ILO01]/.test(c)), "no I, L, O, 0 or 1");
  assert.ok(new Set(codes).size > 35, "codes are not repeating");
});
