// The privacy rules in SPEC.md that code can check.
//   node tests/test-privacy.mjs
//
//   1. Nothing the app runs mentions an AI service.
//   2. The app talks only to Google and Microsoft — no server of its own, no
//      analytics, no CDN.
//   3. No data in the repo: no databases, no backups, no .env, and no email
//      addresses outside example.com in code or docs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const shipped = files.filter((f) => /^(src\/.*\.js|sw\.js|index\.html|privacy\.html)$/.test(f));
assert.ok(shipped.length > 10, 'found the app files');

const AI = /\b(claude|anthropic|openai|chatgpt|gpt-\d|gemini|llm|mistral|cohere|ollama|copilot)\b/i;
const ALLOWED = [
  'accounts.google.com', 'apis.google.com', 'www.googleapis.com', 'oauth2.googleapis.com',
  'login.microsoftonline.com', 'graph.microsoft.com',
  'calendar.app.google', // a placeholder in a form field
];
const problems = [];
for (const f of shipped) {
  const src = read(f);
  const ai = src.match(AI);
  if (ai) problems.push(`${f} mentions ${ai[0]}`);
  for (const [, host] of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    if (!ALLOWED.includes(host.toLowerCase())) problems.push(`${f} reaches ${host}`);
  }
  if (/<script[^>]+src=["']https?:/i.test(src)) problems.push(`${f} loads a script from another site`);
  if (/<link[^>]+href=["']https?:/i.test(src)) problems.push(`${f} loads a stylesheet from another site`);
}

for (const f of files) {
  if (/\.(db|sqlite3?|env)$|(^|\/)\.env|backup.*\.json$/i.test(f)) problems.push(`${f} looks like data`);
  if (!/\.(png|ico)$/.test(f) && f !== 'tests/test-privacy.mjs') {
    for (const [email] of read(f).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      if (!/@example\.com$/i.test(email)) problems.push(`${f} contains an email address: ${email}`);
    }
  }
}

assert.deepEqual(problems, [], `privacy rules broken:\n  ${problems.join('\n  ')}`);
console.log(`privacy ok (${shipped.length} app files, ${files.length} files checked)`);
