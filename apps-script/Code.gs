/**
 * Qualia Coder: Google Apps Script backend.
 * Free to run. Data is stored in the Google Sheet this script is attached to,
 * in a tab called "qualia_records" (created automatically).
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone            (no login needed)
 *               or Anyone with Google account (coworkers sign in to Google)
 */

// Shared team passcode. Strongly recommended, and required if the page is public.
// Use a long passphrase of your own (16+ characters). Leave "" for none.
const PASSCODE = "";

const SHEET_NAME = "qualia_records";
const MAX_JSON = 49000;   // Google Sheets allows 50,000 characters per cell
const MAX_WRITES = 60;    // per request
const PATH_RE = /^[a-z]{2,20}\/[A-Za-z0-9_\-.~:@+]{1,200}$/;

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Qualia Coder")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * JSON API for a copy of the page hosted elsewhere (e.g. GitHub Pages).
 * The page POSTs {fn:"api", arg:{...}} as text/plain and gets JSON back.
 */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    out = req.fn === "api" ? api(req.arg) : { error: "unknown_fn" };
  } catch (err) {
    out = { error: "bad_request" };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    // Standalone script (not attached to a Sheet): create one on first use.
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty("SHEET_ID");
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create("Qualia Coder data");
      props.setProperty("SHEET_ID", ss.getId());
    }
  }
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, 4).setValues([["path", "updatedAt", "deleted", "json"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * One call does both directions:
 *   req = { passcode, since, writes: [{ path: "codes/c123", body: {...} | null }] }
 * Applies the writes (body null = delete), then returns every record changed
 * after `since`, plus `serverTime` to pass as `since` next time.
 * Stamps are monotonic (each write is stamped after the newest stamp in the
 * sheet), so no change is ever skipped even if server clocks differ slightly.
 */
function api(req) {
  req = req || {};
  if (PASSCODE && req.passcode !== PASSCODE) return { error: "bad_passcode" };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { error: "busy" };
  try {
    const sh = getSheet_();
    let rowsN = Math.max(0, sh.getLastRow() - 1);
    const meta = rowsN ? sh.getRange(2, 1, rowsN, 3).getValues() : [];
    const index = {};
    let latest = 0;
    for (let i = 0; i < meta.length; i++) {
      index[meta[i][0]] = i;
      const t = Number(meta[i][1]) || 0;
      if (t > latest) latest = t;
    }

    const writes = Array.isArray(req.writes) ? req.writes.slice(0, MAX_WRITES) : [];
    const rejected = [];
    const appends = [];
    const written = {};
    const stamp = writes.length ? Math.max(Date.now(), latest + 1) : latest;

    for (const w of writes) {
      const path = w && w.path;
      if (typeof path !== "string" || !PATH_RE.test(path)) { rejected.push({ path: String(path), reason: "bad_path" }); continue; }
      const del = w.body === null || w.body === undefined;
      let json = "";
      if (!del) {
        if (typeof w.body !== "object" || Array.isArray(w.body)) { rejected.push({ path: path, reason: "bad_body" }); continue; }
        json = JSON.stringify(w.body);
        if (json.length > MAX_JSON) { rejected.push({ path: path, reason: "too_large" }); continue; }
      }
      const row = [path, stamp, del, json];
      if (Object.prototype.hasOwnProperty.call(index, path)) {
        const i = index[path];
        if (i >= rowsN) appends[i - rowsN] = row;            // appended earlier in this request
        else { sh.getRange(i + 2, 1, 1, 4).setValues([row]); meta[i] = [path, stamp, del]; }
      } else if (!del) {
        index[path] = rowsN + appends.length;
        appends.push(row);
      }
      written[path] = json;
    }
    if (appends.length) {
      sh.getRange(rowsN + 2, 1, appends.length, 4).setValues(appends);
      appends.forEach(r => meta.push([r[0], r[1], r[2]]));
      rowsN += appends.length;
    }

    const since = Number(req.since) || 0;
    const want = [];
    for (let i = 0; i < meta.length; i++) {
      if (since === 0 ? !meta[i][2] : (Number(meta[i][1]) || 0) > since) want.push(i);
    }
    const changes = [];
    if (want.length) {
      const needRead = want.filter(i => !meta[i][2] && !Object.prototype.hasOwnProperty.call(written, meta[i][0]));
      const bulk = needRead.length > 25 ? sh.getRange(2, 4, rowsN, 1).getValues() : null;
      for (const i of want) {
        const path = meta[i][0];
        if (meta[i][2]) { changes.push({ path: path, body: null }); continue; }
        const raw = Object.prototype.hasOwnProperty.call(written, path) ? written[path]
          : (bulk ? bulk[i][0] : sh.getRange(i + 2, 4).getValue());
        try { changes.push({ path: path, body: JSON.parse(raw) }); } catch (e) { /* skip a hand-edited cell */ }
      }
    }
    return { serverTime: stamp, changes: changes, rejected: rejected };
  } finally {
    lock.releaseLock();
  }
}
