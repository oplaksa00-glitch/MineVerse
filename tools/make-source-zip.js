/* GitHub-ready kaynak zip: node_modules / release / dist / .git hariç. */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = process.argv[2] || process.cwd();
const OUT = process.argv[3];
const EXCLUDE_DIRS = new Set(['node_modules', 'release', 'dist', '.git', '.asar']);
const EXCLUDE_FILES = /^(\.DS_Store|Thumbs\.db)$/i;

const zip = new AdmZip();
let count = 0;
function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(abs, relPath);
    } else {
      if (EXCLUDE_FILES.test(entry.name)) continue;
      if (/^secrets\.json$/i.test(entry.name)) continue; // gerçek sırrı asla paketleme
      zip.addLocalFile(abs, path.dirname(relPath) === '.' ? '' : path.dirname(relPath));
      count++;
    }
  }
}
walk(ROOT, '');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
zip.writeZip(OUT);
console.log(`OK ${count} dosya -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
