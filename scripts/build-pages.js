#!/usr/bin/env node
// Builds the static GitHub Pages copy (index.html) from the Apps Script page.
// Usage: node scripts/build-pages.js https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
const fs = require("fs");
const path = require("path");

const url = process.argv[2] || process.env.QUALIA_API_URL;
if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
  console.error("Pass your Apps Script web app URL (ending in /exec).");
  process.exit(1);
}
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "apps-script", "Index.html"), "utf8");
const inject =
  '<meta name="robots" content="noindex,nofollow">\n' +
  `<script>window.QUALIA_API_URL=${JSON.stringify(url)};</script>\n`;
if (!html.includes("</head>")) throw new Error("Index.html has no </head>");
html = html.replace("</head>", inject + "</head>");
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("Wrote index.html for", url);
