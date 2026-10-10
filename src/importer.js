// A family list from a paste or a CSV. The ward directory, a spreadsheet, or
// names typed one per line all work. Read on the device; nothing is uploaded.

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEAD = {
  name: /^(family|household|name|head of household|full name|last name|surname)$/i,
  first: /^(first|first names?|given names?|preferred name)$/i,
  phone: /^(phone|mobile|cell|phone number|household phone|head of household phone)$/i,
  phone2: /^(phone 2|spouse phone|second phone|other phone)$/i,
  email: /^(email|e-mail|email address|household email|head of household email)$/i,
  notes: /^(notes?|comments?)$/i,
};

/** Returns [{ name, first, phone, phone2, email, notes }]. */
export function parseFamilies(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(',') && lines.length > 1 && /,/.test(lines[1]) ? ',' : null;

  if (!sep) return dedupe(lines.map((l) => ({ name: l.trim() })));

  const head = splitCsvLine(lines[0], sep);
  const cols = {};
  head.forEach((h, i) => {
    for (const [k, re] of Object.entries(HEAD)) if (cols[k] === undefined && re.test(h)) cols[k] = i;
  });
  const hasHeader = cols.name !== undefined;
  const rows = (hasHeader ? lines.slice(1) : lines).map((l) => splitCsvLine(l, sep));
  if (!hasHeader) cols.name = 0;

  return dedupe(rows.map((r) => {
    const get = (k) => (cols[k] !== undefined ? r[cols[k]] || '' : '');
    let name = get('name');
    // Directory style "Last, First" in one column is kept as-is; a separate
    // first-name column fills {first}.
    return { name, first: get('first'), phone: get('phone'), phone2: get('phone2'), email: get('email'), notes: get('notes') };
  }).filter((f) => f.name));
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = f.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
