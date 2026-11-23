# Setting up Qualia Coder for your team

About 10 minutes, free, no server. You end up with one link your coworkers open in any browser. They don't need to sign in to anything.

You need a Google account to own the data, plus a GitHub account if you want the GitHub Pages link (recommended).

---

## 1. Create the backend (Google Apps Script)

1. Create a blank **Google Sheet**, e.g. "Qualia Coder data". Your project data will live here.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace everything in `Code.gs` with the contents of [`apps-script/Code.gs`](../apps-script/Code.gs).
4. Click **+ → HTML**, name the file **`Index`** (capital I, no `.html`), and paste in [`apps-script/Index.html`](../apps-script/Index.html).
5. **Set a passcode.** Near the top of `Code.gs`:
   ```js
   const PASSCODE = "a-long-passphrase-of-your-own";
   ```
   Use 16+ characters, and don't reuse a password from another account. Your coworkers enter it once per device.
6. Save (⌘/Ctrl + S).

## 2. Deploy it as a web app

1. **Deploy → New deployment →** gear icon **→ Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and authorise access to your spreadsheet. If Google shows "Google hasn't verified this app", choose **Advanced → Go to (unsafe) → Allow**. It's your own script, and it only touches your Sheet.
4. Copy the **Web app URL** that ends in `/exec`.

This URL already works as a team link. But if a coworker's browser is signed in to several Google accounts, Apps Script pages can fail with "Sorry, unable to open the file at this time". Step 3 avoids that.

## 3. Publish the page on GitHub Pages (recommended)

1. Fork this repository.
2. Build the page against your backend:
   ```bash
   node scripts/build-pages.js https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
   ```
   This rewrites `index.html`. Commit and push it.
3. In your fork, go to **Settings → Pages**, choose *Deploy from a branch*, then `main` and `/ (root)`.
4. After a minute, your team link is `https://<your-username>.github.io/qualia-coder/`.

The repository only holds the page. Your data stays in your Sheet, protected by the passcode.

## 4. Invite your team

Send the link and the passcode through **different channels**, for example the link by email and the passcode in person or in chat. Each person:

1. Opens the link and enters the passcode.
2. Types their name. It's shown next to every passage they code. Typing the same name on another device continues as the same coder.

---

## Updating

- **Backend changes** (`Code.gs`): **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same. (*New deployment* would create a new URL.)
- **Changing the passcode**: edit `PASSCODE`, then redeploy a new version as above. Do this whenever someone leaves the team.
- **Frontend changes** (`Index.html`): update the Apps Script file, rerun `build-pages.js`, and push.

## Housekeeping

- **Backups:** use **Project → Export project (.json)** regularly. The Sheet also keeps Google's version history.
- **Don't hand-edit** the `qualia_records` tab. Reading it is fine.
- **Starting over:** export first, then delete the `qualia_records` tab.
- **Scale:** comfortable for about 3–10 people coding at the same time.
- **Sensitive data:** de-identify transcripts before uploading, and follow your ethics board's (IRB) and consent-form requirements.
