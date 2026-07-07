#!/usr/bin/env node
// Build-time check: extract JS from HTML template and validate syntax
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.ts'), 'utf8');
const match = src.match(/const HTML = `([\s\S]*?)`;/);
if (!match) { console.error('ERROR: Could not find HTML template literal'); process.exit(1); }

const html = match[1];
const jsMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!jsMatch) { console.error('ERROR: No <script> tag found in HTML'); process.exit(1); }

const js = '(async function(){' + jsMatch[1] + '})()';
const tmpFile = path.join(__dirname, '.check-tmp.js');
fs.writeFileSync(tmpFile, js);

const { execSync } = require('child_process');
try {
  execSync('node --check ' + tmpFile, { stdio: 'pipe' });
  console.log('✅ HTML JS syntax OK');
} catch (e) {
  console.error('❌ JS syntax error in HTML template:');
  console.error(e.stderr.toString());
  process.exit(1);
} finally {
  fs.unlinkSync(tmpFile);
}
