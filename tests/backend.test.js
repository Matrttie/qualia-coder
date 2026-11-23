// Runs apps-script/Code.gs against an in-memory fake of SpreadsheetApp / LockService.
// Usage: node tests/backend.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "..", "apps-script", "Code.gs"), "utf8");

function makeEnv(passcode) {
  let rows = null; // 2D array incl. header, created by insertSheet
  let ops = 0;
  const sheet = {
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      ops++;
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const R = rows[r - 1 + i]; row.push(R ? (R[c - 1 + j] ?? "") : ""); } out.push(row); } return out; },
        getValue() { return this.getValues()[0][0]; },
        setValues(v) { assert.strictEqual(v.length, nr); for (let i = 0; i < nr; i++) { assert.strictEqual(v[i].length, nc); while (rows.length < r + i) rows.push([]); for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j]; } },
      };
    },
  };
  const ss = { getSheetByName: () => (rows ? sheet : null), insertSheet: () => { rows = []; return sheet; }, getId: () => "fake" };
  let now = 1_000_000;
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    HtmlService: {},
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
    Date: { now: () => now },
    JSON, Number, String, Math, Object, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(passcode !== undefined ? src.replace(/const PASSCODE = "";/, `const PASSCODE = ${JSON.stringify(passcode)};`) : src, ctx);
  // emulate google.script.run's serialization boundary
  const call = req => JSON.parse(JSON.stringify(ctx.api(JSON.parse(JSON.stringify(req)))));
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: body } }).text);
  return { call, post, setNow: t => { now = t; }, rows: () => rows, ops: () => ops };
}

let pass = 0; const t = (name, fn) => { fn(); pass++; console.log("ok  -", name); };

t("empty sheet: first sync returns nothing, serverTime 0", () => {
  const e = makeEnv();
  const r = e.call({ since: 0, writes: [] });
  assert.deepStrictEqual(r.changes, []); assert.strictEqual(r.serverTime, 0);
});

t("writes are stored and echoed; incremental poll is empty", () => {
  const e = makeEnv();
  const r1 = e.call({ since: 0, writes: [{ path: "codes/c1", body: { name: "A" } }, { path: "documents/d1", body: { name: "Doc" } }] });
  assert.strictEqual(r1.changes.length, 2); assert.ok(r1.serverTime > 0);
  const r2 = e.call({ since: r1.serverTime, writes: [] });
  assert.deepStrictEqual(r2.changes, []); assert.strictEqual(r2.serverTime, r1.serverTime);
});

t("another client's update and delete reach the first client", () => {
  const e = makeEnv();
  const a = e.call({ since: 0, writes: [{ path: "codes/c1", body: { name: "A" } }, { path: "codes/c2", body: { name: "B" } }] });
  e.setNow(1_000_500);
  e.call({ since: 0, writes: [{ path: "codes/c1", body: { name: "A2" } }, { path: "codes/c2", body: null }] }); // client B
  const a2 = e.call({ since: a.serverTime, writes: [] });
  const m = Object.fromEntries(a2.changes.map(c => [c.path, c.body]));
  assert.deepStrictEqual(m["codes/c1"], { name: "A2" }); assert.strictEqual(m["codes/c2"], null);
  assert.strictEqual(e.rows().length, 3, "update/delete reuse rows (header + 2)");
});

t("fresh client never sees tombstones", () => {
  const e = makeEnv();
  e.call({ since: 0, writes: [{ path: "memos/m1", body: { title: "x" } }] });
  e.call({ since: 0, writes: [{ path: "memos/m1", body: null }] });
  const r = e.call({ since: 0, writes: [] });
  assert.deepStrictEqual(r.changes, []);
});

t("server clock going backwards still produces newer stamps", () => {
  const e = makeEnv();
  const a = e.call({ since: 0, writes: [{ path: "codes/c1", body: { n: 1 } }] });
  e.setNow(5); // a different Google machine with a clock far behind
  e.call({ since: 0, writes: [{ path: "codes/c1", body: { n: 2 } }] });
  const a2 = e.call({ since: a.serverTime, writes: [] });
  assert.strictEqual(a2.changes.length, 1); assert.deepStrictEqual(a2.changes[0].body, { n: 2 });
  assert.ok(a2.serverTime > a.serverTime);
});

t("oversized and malformed writes are rejected, valid ones in the same batch still saved", () => {
  const e = makeEnv();
  const big = "字".repeat(49001);
  const r = e.call({ since: 0, writes: [
    { path: "memos/m1", body: { content: big } },
    { path: "bad path", body: { x: 1 } },
    { path: "codes/c1", body: [1, 2] },
    { path: "codes/ok", body: { name: "fine" } },
  ] });
  assert.deepStrictEqual(r.rejected.map(x => x.reason), ["too_large", "bad_path", "bad_body"]);
  assert.deepStrictEqual(r.changes.map(c => c.path), ["codes/ok"]);
});

t("a 20,000-char CJK text chunk with newlines and quotes fits in one cell", () => {
  const e = makeEnv();
  const text = ("受訪者：\"我覺得\"\n".repeat(2000)).slice(0, 20000);
  const r = e.call({ since: 0, writes: [{ path: "doctext/d1-0", body: { docId: "d1", i: 0, text } }] });
  assert.deepStrictEqual(r.rejected, []); assert.strictEqual(r.changes[0].body.text, text);
});

t("same new path twice in one batch makes one row with the last value", () => {
  const e = makeEnv();
  e.call({ since: 0, writes: [{ path: "codes/c1", body: { v: 1 } }, { path: "codes/c1", body: { v: 2 } }] });
  const r = e.call({ since: 0, writes: [] });
  assert.strictEqual(e.rows().length, 2); assert.deepStrictEqual(r.changes[0].body, { v: 2 });
});

t("large incremental change set uses one bulk read", () => {
  const e = makeEnv();
  const ws = []; for (let i = 0; i < 60; i++) ws.push({ path: "quotations/q" + i, body: { i } });
  const a = e.call({ since: 0, writes: [] });
  e.call({ since: 0, writes: ws }); // client B
  const before = e.ops();
  const r = e.call({ since: a.serverTime, writes: [] });
  assert.strictEqual(r.changes.length, 60);
  assert.ok(e.ops() - before <= 3, "expected bulk read, got " + (e.ops() - before) + " range ops");
});

t("passcode: wrong is refused and nothing is written, right works", () => {
  const e = makeEnv("team-2026");
  assert.deepStrictEqual(e.call({ passcode: "nope", since: 0, writes: [{ path: "codes/c1", body: { a: 1 } }] }), { error: "bad_passcode" });
  assert.strictEqual(e.rows(), null);
  const r = e.call({ passcode: "team-2026", since: 0, writes: [{ path: "codes/c1", body: { a: 1 } }] });
  assert.strictEqual(r.changes.length, 1);
});

t("doPost: JSON API used by the GitHub Pages copy", () => {
  const e = makeEnv("team-2026");
  assert.deepStrictEqual(e.post(JSON.stringify({ fn: "api", arg: { since: 0, writes: [] } })), { error: "bad_passcode" });
  const r = e.post(JSON.stringify({ fn: "api", arg: { passcode: "team-2026", since: 0, writes: [{ path: "codes/c1", body: { a: 1 } }] } }));
  assert.strictEqual(r.changes.length, 1);
  assert.deepStrictEqual(e.post("not json"), { error: "bad_request" });
  assert.deepStrictEqual(e.post(JSON.stringify({ fn: "getSheet_" })), { error: "unknown_fn" });
});

console.log(`\n${pass} backend tests passed`);
