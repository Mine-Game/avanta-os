#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const textExt = new Set(['.js', '.json', '.md', '.html', '.css', '.txt']);
const badPatterns = [
  /D�/g,
  /�\?/g,
  /\?\?\?/g,
  /A\?/g,
  /\uFFFD/g,
];

function ext(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function getStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

let hasError = false;
const files = getStagedFiles();

for (const file of files) {
  if (file === 'tools/check-encoding.js') continue;
  if (!textExt.has(ext(file))) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (content.includes('\u0000')) {
    console.error(`❌ ${file}: contains NUL bytes (possible corruption).`);
    hasError = true;
  }

  for (const rx of badPatterns) {
    if (rx.test(content)) {
      console.error(`❌ ${file}: suspicious mojibake pattern detected (${rx}).`);
      hasError = true;
      break;
    }
  }
}

if (hasError) {
  console.error('\nCommit blocked: encoding/mojibake guard failed.');
  console.error('Fix the text encoding to UTF-8 and remove corrupted fragments.');
  process.exit(1);
}

console.log('✅ Encoding guard passed.');
