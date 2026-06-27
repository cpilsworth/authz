/* eslint-disable import/no-unresolved, no-console */

// DA admin base + token-fresh fetch, same wiring the platform tools use.
const { getDaAdmin } = await import('https://da.live/nx/public/utils/constants.js');
const DA_ADMIN = getDaAdmin();
const { daFetch, initIms } = await import('https://da.live/nx/utils/daFetch.js');

// Publisher Worker that reads DA config, validates/signs the policy, and writes it to KV
// for the delivery worker to enforce. Distinct from the delivery worker.
export const PUBLISHER_URL = 'https://oidc-worker-gate-policy-publisher.cpilsworth.workers.dev/';

// The access-control policy lives as a NAMED SHEET ("access-control") inside the
// SITE config multi-sheet at `${DA_ADMIN}/config/{org}/{site}/`. It is read/written as
// part of the whole config document; we never write a standalone source file.
export const SHEET_NAME = 'access-control';
export const POLICY_COLUMNS = ['path', 'tier', 'audience', 'description'];

/**
 * Fetch the full site config multi-sheet document.
 * @returns {{ canAccess:boolean, readOnly:boolean, config:object|null, status:number }}
 */
export async function fetchSiteConfig(org, site) {
  try {
    const res = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`);
    if (res.status === 401 || res.status === 403) {
      return {
        canAccess: false, readOnly: true, config: null, status: res.status,
      };
    }
    if (!res.ok) {
      return {
        canAccess: false, readOnly: true, config: null, status: res.status,
      };
    }
    const config = await res.json();
    return {
      canAccess: true, readOnly: false, config, status: res.status,
    };
  } catch (e) {
    console.warn('[da-access-control] fetchSiteConfig failed:', e);
    return {
      canAccess: false, readOnly: true, config: null, status: 0,
    };
  }
}

/**
 * Extract the access-control rows from a fetched config document.
 * Returns [] when the sheet is absent (it will be created on save).
 */
export function getPolicyRows(config) {
  const sheet = config?.[SHEET_NAME];
  const rows = Array.isArray(sheet?.data) ? sheet.data : [];
  // Keep only the enforced columns we know; preserve unknown keys for round-trip.
  return rows.map((row) => ({ ...row }));
}

/**
 * Produce a new config document with the access-control sheet replaced by `rows`,
 * preserving every other sheet, `:names`, `:version`, `:type`, and `:colWidths`.
 */
export function withPolicyRows(config, rows) {
  const base = config ? structuredClone(config) : { ':version': 3, ':type': 'multi-sheet' };
  const existing = base[SHEET_NAME] || {};
  const data = rows.map((row) => ({ ...row }));
  base[SHEET_NAME] = {
    total: data.length,
    limit: data.length,
    offset: 0,
    data,
    ':colWidths': existing[':colWidths'] || [125, 96, 92, 328],
  };
  // Ensure the multi-sheet envelope lists the access-control sheet.
  base[':type'] = base[':type'] || 'multi-sheet';
  const names = Array.isArray(base[':names']) ? base[':names'] : [];
  base[':names'] = names.includes(SHEET_NAME) ? names : [...names, SHEET_NAME];
  return base;
}

/**
 * Write the full config document back. Mirrors the platform config-write contract:
 * POST multipart/form-data with field `config` = JSON.stringify(document).
 */
export async function updateSiteConfig(org, site, config) {
  try {
    const formData = new FormData();
    formData.append('config', JSON.stringify(config));
    const res = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`, {
      method: 'POST',
      body: formData,
    });
    return { success: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { success: false, status: 0, error: e.message };
  }
}

/** List sites in an org for the switcher. */
export async function fetchSiteList(org) {
  try {
    const res = await daFetch(`${DA_ADMIN}/list/${org}/`);
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    return items.filter((item) => !item.ext).map((item) => item.name);
  } catch {
    return [];
  }
}

/** Resolve a fresh IMS access token, falling back to one captured earlier. */
export async function getAccessToken(fallback) {
  try {
    const { accessToken } = await initIms();
    return accessToken?.token || fallback || '';
  } catch {
    return fallback || '';
  }
}

/**
 * Ask the publisher Worker to re-read DA config, re-validate/sign the policy, and write it
 * to KV for the delivery worker. The publisher reads DA itself using the bearer token; we
 * do not send rule content.
 * @returns {{ success:boolean, status:number, result?:object, error?:string }}
 */
export async function publishPolicy(org, site, token, sourceVersion) {
  const body = { site_id: `${org}/${site}` };
  if (sourceVersion) body.source_version = sourceVersion;
  try {
    const res = await fetch(PUBLISHER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    let result = null;
    try { result = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: result?.error || result?.message || `HTTP ${res.status}`,
      };
    }
    return { success: true, status: res.status, result };
  } catch (e) {
    // A failed CORS preflight surfaces here as a TypeError with no status.
    return { success: false, status: 0, error: e.message };
  }
}
