#!/usr/bin/env node
/**
 * Se ejecuta ANTES de cada despliegue (hook `predeploy:*` de package.json).
 *
 *  1. Sube la versión (patch) en package.json y package-lock.json.
 *  2. Hace UN commit con todo lo que haya en el árbol (`git add -A`) y la versión nueva,
 *     para que lo que se sube a AWS quede siempre documentado en git.
 *  3. El cuerpo del commit lista los commits que entran desde el despliegue anterior y los
 *     archivos sueltos que se hayan incluido.
 *
 * Si algo falla, sale con error y el despliegue NO continúa.
 * Uso: node scripts/release-version.mjs <qas|prd|all>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const stage = process.argv[2] || 'qas';
const TRAILER = 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fail = (message) => {
  console.error(`[release-version] ${message}`);
  process.exit(1);
};

try {
  if (git('rev-parse', '--is-inside-work-tree').trim() !== 'true') fail('esto no es un repositorio git.');
} catch {
  fail('esto no es un repositorio git.');
}

const read = (file) => fs.readFileSync(file, 'utf8');
const eol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// ---- 1. versión nueva
const pkgText = read('package.json');
const match = pkgText.match(/"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)([^"]*)"/);
if (!match) fail('package.json no tiene una versión x.y.z.');
const oldVersion = `${match[1]}.${match[2]}.${match[3]}${match[4]}`;
const version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
fs.writeFileSync('package.json', pkgText.replace(match[0], match[0].replace(oldVersion, version)));

if (fs.existsSync('package-lock.json')) {
  const lockText = read('package-lock.json');
  const nl = eol(lockText);
  let lock;
  try {
    lock = JSON.parse(lockText);
  } catch {
    lock = null;
  }
  const normalized = lock ? JSON.stringify(lock, null, 2).replace(/\n/g, nl) + nl : null;
  if (lock && (normalized === lockText || normalized === lockText.replace(/\r?\n$/, '') + nl)) {
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2).replace(/\n/g, nl) + nl);
  } else {
    // Formato distinto del de npm: solo se tocan las dos primeras apariciones de la versión.
    let count = 0;
    fs.writeFileSync(
      'package-lock.json',
      lockText.replace(new RegExp(`("version"\\s*:\\s*")${oldVersion.replace(/\./g, '\\.')}(")`, 'g'), (all, a, b) =>
        count++ < 2 ? `${a}${version}${b}` : all,
      ),
    );
  }
}

// ---- 2. qué entra desde el despliegue anterior
let previous = '';
try {
  previous = git('log', '-1', '--format=%H', '--grep=^chore: version .* desplegada a').trim();
} catch {
  previous = '';
}
let entries = [];
try {
  const range = previous ? [`${previous}..HEAD`] : ['-n', '20'];
  entries = git('log', '--format=- %s', ...range).split('\n').filter(Boolean);
} catch {
  entries = [];
}

// ---- 3. commit de todo
git('add', '-A');
const staged = git('diff', '--cached', '--name-status').split('\n').filter(Boolean);
const loose = staged.filter((line) => !/\s(package\.json|package-lock\.json)$/.test(line));

const lines = [`chore: version ${version} desplegada a ${stage}`, ''];
lines.push(entries.length ? `Entra desde ${previous ? previous.slice(0, 8) : 'el inicio'} (${entries.length}):` : 'Sin commits nuevos desde el despliegue anterior.');
lines.push(...entries.slice(0, 40));
if (entries.length > 40) lines.push(`… y ${entries.length - 40} más`);
if (loose.length) {
  lines.push('', `Archivos sin commitear que entraron en este commit (${loose.length}):`);
  lines.push(...loose.slice(0, 40).map((l) => `  ${l.replace(/\t/g, ' ')}`));
}
if (process.env.CLAUDECODE) lines.push('', TRAILER);

try {
  git('commit', '-q', '-m', lines.join('\n'));
} catch (error) {
  fail(`no pude hacer el commit de la versión: ${(error.stderr || error.message).toString().trim()}`);
}

const sha = git('rev-parse', '--short', 'HEAD').trim();
console.log(`[release-version] ${oldVersion} → ${version} (${stage}) · commit ${sha}` + (loose.length ? ` · incluye ${loose.length} archivo(s) sueltos` : ''));
