/* eslint-disable no-restricted-syntax */

// Advisory validation that MIRRORS the oidc-worker-gate publisher rules
// (da-access-control-policy-spec.md). The publisher re-validates and is authoritative;
// this is fast author-time feedback only and must never fail open.

export const TIERS = ['public', 'protected', 'secured'];
export const ENFORCED_COLUMNS = ['path', 'tier', 'audience', 'description'];

// Operator/worker-managed + reserved paths (spec "Worker-managed paths"). DA rows that
// overlap these are ignored by the worker, not enforced. Editable by the operator.
export const RESERVED_PATHS = [
  '/.auth/**',
  '/scripts/**',
  '/styles/**',
  '/blocks/**',
  '/icons/**',
  '/fonts/**',
  '/media_*',
  '/sitemap.xml',
  '/robots.txt',
  '/.well-known/**',
  '/nav.plain.html',
  '/footer.plain.html',
];

/** Parse an audience cell: CSV, trim, drop empties, dedupe, case-sensitive. */
export function parseAudience(value) {
  const seen = new Set();
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

export function normalizeTier(value) {
  return (value || '').trim().toLowerCase();
}

function isBlankRow(row) {
  return ENFORCED_COLUMNS.every((c) => !String(row[c] ?? '').trim());
}

// --- Pattern matching (DA-style globs), used for specificity + overlap detection. ---

function patternToRegExp(pattern) {
  // Escape regex special chars except * which we expand. ** spans separators; * stays in-segment.
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i += 1; } else { re += '[^/]*'; }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Does a path pattern match a concrete path? Handles terminal /** folder form. */
export function matchPath(pattern, path) {
  if (pattern === path) return true;
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3); // strip "/**"
    if (path === base || path === `${base}/`) return true;
  }
  return patternToRegExp(pattern).test(path);
}

/** Literal prefix length before the first wildcard (longer = more specific). */
function literalPrefixLength(pattern) {
  const star = pattern.indexOf('*');
  return star === -1 ? pattern.length : star;
}

function hasWildcard(p) {
  return p.includes('*');
}

/** Specificity key: exact paths outrank globs; then longest literal prefix. */
function specificity(pattern) {
  return { exact: !hasWildcard(pattern), prefix: literalPrefixLength(pattern) };
}

function overlaps(a, b) {
  // Two terminal-folder globs overlap if one's base contains the other's.
  return matchPath(a, b.replace(/\/\*\*$/, '')) || matchPath(b, a.replace(/\/\*\*$/, ''))
    || matchPath(a, b) || matchPath(b, a);
}

/**
 * Validate all rows.
 * @param {object[]} rows
 * @param {object} opts { knownAudiences?: string[], reservedPaths?: string[] }
 * @returns {object} per-row results plus globalErrors/globalWarnings/hasErrors
 */
export function validateRows(rows, opts = {}) {
  const knownAudiences = opts.knownAudiences || null; // null => warn-only mode
  const reserved = opts.reservedPaths || RESERVED_PATHS;
  const unknownColumns = new Set();

  const results = rows.map(() => ({
    errors: {}, warnings: {}, rowErrors: [], rowWarnings: [], ignored: false,
  }));

  rows.forEach((row, i) => {
    const r = results[i];
    if (isBlankRow(row)) return; // blank rows allowed and ignored

    // unknown columns -> warning (ignored for enforcement)
    Object.keys(row).forEach((k) => {
      if (!k.startsWith(':') && !ENFORCED_COLUMNS.includes(k) && String(row[k] ?? '').trim()) {
        unknownColumns.add(k);
      }
    });

    const path = String(row.path ?? '').trim();
    const tier = normalizeTier(row.tier);
    const audience = parseAudience(row.audience);

    // path
    if (!path) {
      r.errors.path = 'Path is required.';
    } else {
      if (!path.startsWith('/')) r.errors.path = 'Path must be absolute (start with "/").';
      if (path.includes('?') || path.includes('#')) r.errors.path = 'Path must not contain "?" or "#".';
    }

    // tier
    if (!row.tier || !String(row.tier).trim()) {
      r.errors.tier = 'Tier is required.';
    } else if (!TIERS.includes(tier)) {
      r.errors.tier = `Tier must be one of: ${TIERS.join(', ')}.`;
    }

    // audience semantics
    if (tier === 'public' && audience.length) {
      r.errors.audience = 'A public row must not have an audience.';
    }
    if ((tier === 'protected' || tier === 'secured') && audience.length === 0) {
      r.warnings.audience = 'Empty audience means any authenticated user.';
    }
    if (knownAudiences && audience.length) {
      const unknown = audience.filter((a) => !knownAudiences.includes(a));
      if (unknown.length) r.warnings.audience = `Unknown audience(s): ${unknown.join(', ')}.`;
    }

    // reserved-path overlap -> ignored by worker
    if (path && reserved.some((rp) => matchPath(rp, path) || matchPath(path, rp.replace(/\/\*\*$/, '')))) {
      r.ignored = true;
      r.warnings.path = 'Overlaps a worker-managed path; this row will be ignored, not enforced.';
    }

    Object.entries(r.errors).forEach(([k, v]) => r.rowErrors.push(`${k}: ${v}`));
    Object.entries(r.warnings).forEach(([k, v]) => r.rowWarnings.push(`${k}: ${v}`));
  });

  // cross-row: equal-specificity overlap rejection
  const globalErrors = [];
  const active = rows
    .map((row, i) => ({ i, path: String(row.path ?? '').trim() }))
    .filter((x) => x.path && !results[x.i].errors.path && !results[x.i].ignored);

  for (let a = 0; a < active.length; a += 1) {
    for (let b = a + 1; b < active.length; b += 1) {
      const pa = active[a].path;
      const pb = active[b].path;
      if (pa === pb) {
        globalErrors.push(`Duplicate path "${pa}" on rows ${active[a].i + 1} and ${active[b].i + 1}.`);
        results[active[a].i].errors.path = 'Duplicate path.';
        results[active[b].i].errors.path = 'Duplicate path.';
      } else if (overlaps(pa, pb)) {
        const sa = specificity(pa);
        const sb = specificity(pb);
        const equal = sa.exact === sb.exact && sa.prefix === sb.prefix;
        if (equal) {
          globalErrors.push(`Equal-specificity overlap between "${pa}" and "${pb}" (rows ${active[a].i + 1}, ${active[b].i + 1}).`);
          results[active[a].i].warnings.path = results[active[a].i].warnings.path
            || `Equal-specificity overlap with "${pb}".`;
          results[active[b].i].warnings.path = results[active[b].i].warnings.path
            || `Equal-specificity overlap with "${pa}".`;
        }
      }
    }
  }

  const globalWarnings = [];
  if (unknownColumns.size) {
    globalWarnings.push(`Unknown column(s) ignored by enforcement: ${[...unknownColumns].join(', ')}.`);
  }

  const hasErrors = globalErrors.length > 0
    || results.some((r) => Object.keys(r.errors).length > 0);

  return {
    rows: results, globalErrors, globalWarnings, hasErrors,
  };
}

/** Collect audience names already used in rows (suggestions for the chip input). */
export function collectAudiences(rows) {
  const set = new Set();
  rows.forEach((row) => parseAudience(row.audience).forEach((a) => set.add(a)));
  return [...set].sort();
}
