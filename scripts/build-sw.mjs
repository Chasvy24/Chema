// Après « vite build » : injecte la liste des fichiers à mettre en cache et un numéro de version dans dist/sw.js.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split('\\').join('/'));
  }
})(dist);

// PDF.js (lecture des relevés PDF) n'est pas pré-téléchargé : il est mis en cache à sa première utilisation.
const precache = files
  .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.split('/').some((part) => part.startsWith('.')) && !/(^|\/)pdf[.-]/.test(f))
  .map((f) => './' + f);
const hash = createHash('sha256');
for (const f of precache.sort()) hash.update(f).update(readFileSync(join(dist, f.slice(2))));
const version = hash.digest('hex').slice(0, 12);

const swPath = join(dist, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace("'__BUILD_VERSION__'", JSON.stringify(version)).replace('self.__PRECACHE || []', JSON.stringify(precache));
writeFileSync(swPath, sw);
console.log(`sw.js : ${precache.length} fichiers en cache, version ${version}`);
