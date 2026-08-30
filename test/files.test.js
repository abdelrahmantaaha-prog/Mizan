/* Attachments are the seam between "what the person picked" and "what goes in
   the request". The part worth pinning is the routing: a PDF that was readable
   here must not also be uploaded, and a stack of separate receipts must not
   quietly become one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toAiInput, rejectionMessage, prettySize, MAX_FILES } from "../src/lib/files.js";

const image = (name) => ({ kind: "image", name, size: 100, file: { media: "image/jpeg", data: "AAA" } });
const doc = (name) => ({ kind: "doc", name, size: 100, file: { media: "application/pdf", data: "BBB" } });
const text = (name, body) => ({ kind: "text", name, size: 100, text: body });

test("images and unreadable PDFs go up as files, in the order picked", () => {
  const got = toAiInput([image("a.jpg"), doc("b.pdf"), image("c.png")]);
  assert.deepEqual(got.files.map((f) => f.media), ["image/jpeg", "application/pdf", "image/jpeg"]);
  assert.equal(got.docText, null);
});

test("a PDF read here becomes prompt text, and is not also uploaded", () => {
  const got = toAiInput([text("statement.pdf", "12/08 UBER 70.00")]);
  assert.equal(got.files.length, 0, "the bytes are not sent as well");
  assert.match(got.docText, /statement\.pdf/, "the name is kept so the model knows what it is reading");
  assert.match(got.docText, /UBER 70\.00/);
});

test("a mixed pick sends each half the cheapest way that works", () => {
  const got = toAiInput([text("bank.pdf", "12/08 UBER 70.00"), image("receipt.jpg")]);
  assert.equal(got.files.length, 1);
  assert.equal(got.files[0].media, "image/jpeg");
  assert.match(got.docText, /UBER/);
});

test("an enormous text file is trimmed rather than sent whole", () => {
  const got = toAiInput([text("huge.csv", "x".repeat(50000))]);
  assert.ok(got.docText.length < 25000, "trimmed to something a prompt can carry");
});

test("nothing attached is nothing to send", () => {
  const got = toAiInput([]);
  assert.deepEqual(got.files, []);
  assert.equal(got.docText, null);
});

/* ---------- what the person is told ---------- */

test("refusals name the file and say what to do instead", () => {
  assert.equal(rejectionMessage([]), null);
  assert.match(rejectionMessage([{ name: "scan.pdf", why: "too-big" }]), /scan\.pdf.*too large/);
  assert.match(rejectionMessage([{ name: "x.jpg", why: "too-many" }]), new RegExp(String(MAX_FILES)));
  assert.match(rejectionMessage([{ name: "notes.docx", why: "unsupported" }]), /notes\.docx/);
});

test("sizes read as sizes", () => {
  assert.equal(prettySize(512), "512 B");
  assert.equal(prettySize(2048), "2 KB");
  assert.equal(prettySize(5 * 1024 * 1024), "5.0 MB");
});
