/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  fetchSiteConfig,
  getPolicyRows,
  withPolicyRows,
  updateSiteConfig,
  fetchSiteList,
  getAccessToken,
  publishPolicy,
} from './api.js';
import {
  TIERS,
  validateRows,
  collectAudiences,
} from './validation.js';
import icon from './icons.js';

const NX = 'https://da.live/nx';

// Load shared platform styles (best-effort) + our own stylesheet.
let nexter = null;
let styles = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  [nexter, styles] = await Promise.all([
    getStyle(`${NX}/styles/nexter.css`),
    getStyle(new URL('./da-access-control.css', import.meta.url).href),
  ]);
} catch (e) {
  console.warn('[da-access-control] style load failed:', e);
}

const EMPTY_ROW = () => ({
  path: '', tier: 'protected', audience: '', description: '',
});

function updateUrl(org, site) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('org', org);
    url.searchParams.set('site', site);
    window.history.replaceState(null, '', url);
  } catch { /* noop */ }
}

function renderCellMsg(rowResult, key) {
  const err = rowResult?.errors?.[key];
  const warn = rowResult?.warnings?.[key];
  if (err) return html`<div class="dac-cellmsg dac-cellmsg-error">${err}</div>`;
  if (warn) return html`<div class="dac-cellmsg dac-cellmsg-warning">${warn}</div>`;
  return nothing;
}

function msgIcon(type) {
  if (type === 'success') return icon('check');
  if (type === 'error') return icon('error');
  return icon('warning');
}

class DaAccessControlApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    _state: { state: true }, // 'idle' | 'loading' | 'ready' | 'error'
    _org: { state: true },
    _site: { state: true },
    _orgInput: { state: true },
    _siteInput: { state: true },
    _siteList: { state: true },
    _config: { state: true },
    _rows: { state: true },
    _validation: { state: true },
    _dirty: { state: true },
    _readOnly: { state: true },
    _saving: { state: true },
    _publishing: { state: true },
    _message: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, styles].filter(Boolean);

    this._state = 'idle';
    this._org = '';
    this._site = '';
    this._orgInput = '';
    this._siteInput = '';
    this._siteList = [];
    this._config = null;
    this._rows = [];
    this._validation = null;
    this._dirty = false;
    this._readOnly = false;
    this._saving = false;
    this._publishing = false;
    this._message = null;

    this._beforeUnload = (e) => {
      if (this._dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', this._beforeUnload);

    // Resolve target org/site: URL params win, then SDK context.
    const params = new URLSearchParams(window.location.search);
    const org = (params.get('org') || this.context?.org || '').trim();
    const site = (params.get('site') || this.context?.repo || '').trim();
    this._orgInput = org;
    this._siteInput = site;
    if (org && site) this.load(org, site);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('beforeunload', this._beforeUnload);
  }

  async load(org, site) {
    this._state = 'loading';
    this._message = null;
    this._org = org;
    this._site = site;
    updateUrl(org, site);

    const [{ canAccess, config, status }, siteList] = await Promise.all([
      fetchSiteConfig(org, site),
      fetchSiteList(org),
    ]);
    this._siteList = siteList;

    if (!canAccess) {
      this._state = 'error';
      this._message = status === 401 || status === 403
        ? { type: 'error', text: `You do not have access to ${org}/${site} (HTTP ${status}).` }
        : { type: 'error', text: `Could not load config for ${org}/${site} (HTTP ${status || '?'}).` };
      return;
    }

    this._config = config;
    this._rows = getPolicyRows(config);
    if (this._rows.length === 0) this._rows = [];
    this._dirty = false;
    this._readOnly = false;
    this.revalidate();
    this._state = 'ready';
  }

  revalidate() {
    // Warn-only audience mode: pass no knownAudiences so unknowns are not errors.
    this._validation = validateRows(this._rows);
  }

  // --- row editing ---
  updateCell(index, key, value) {
    const rows = this._rows.map((r, i) => (i === index ? { ...r, [key]: value } : r));
    this._rows = rows;
    this._dirty = true;
    this.revalidate();
  }

  addRow() {
    this._rows = [...this._rows, EMPTY_ROW()];
    this._dirty = true;
    this.revalidate();
  }

  removeRow(index) {
    this._rows = this._rows.filter((_, i) => i !== index);
    this._dirty = true;
    this.revalidate();
  }

  async save() {
    if (this._readOnly || this._saving) return;
    if (this._validation?.hasErrors) {
      this._message = { type: 'error', text: 'Fix the errors before saving.' };
      return;
    }
    this._saving = true;
    this._message = null;
    // Drop fully-blank rows before persisting.
    const rows = this._rows.filter(
      (r) => ['path', 'tier', 'audience', 'description'].some((c) => String(r[c] ?? '').trim()),
    );
    const next = withPolicyRows(this._config, rows);
    const { success, status, error } = await updateSiteConfig(this._org, this._site, next);
    this._saving = false;
    if (success) {
      this._config = next;
      this._rows = rows;
      this._dirty = false;
      this.revalidate();
      this._message = { type: 'success', text: 'Access-control policy saved.' };
    } else {
      this._message = {
        type: 'error',
        text: status === 401 || status === 403
          ? `Save failed: you lack write access (HTTP ${status}).`
          : `Save failed (${error || 'unknown error'}).`,
      };
    }
  }

  async publish() {
    if (this._publishing) return;
    if (this._dirty) {
      this._message = { type: 'warning', text: 'Save your changes before publishing to the worker.' };
      return;
    }
    this._publishing = true;
    this._message = null;
    const token = await getAccessToken(this.token);
    // Marker only, for the publisher's status log; it reads + versions DA itself.
    const sourceVersion = new Date().toISOString();
    const {
      success, status, result, error,
    } = await publishPolicy(
      this._org,
      this._site,
      token,
      sourceVersion,
    );
    this._publishing = false;
    if (success) {
      const r = result || {};
      const warns = Array.isArray(r.warnings) && r.warnings.length
        ? ` ${r.warnings.length} warning(s).` : '';
      this._message = {
        type: 'success',
        text: `Published v${r.version || '?'} — ${r.rules ?? '?'} rule(s), ${r.ignored_rules ?? 0} ignored.${warns}`,
      };
    } else if (status === 401 || status === 403) {
      this._message = { type: 'error', text: `Publish failed: not authorized (HTTP ${status}). Try reloading the tool.` };
    } else if (status === 0) {
      this._message = { type: 'error', text: `Publish failed: could not reach the publisher (likely CORS or network). ${error || ''}` };
    } else {
      this._message = { type: 'error', text: `Publish failed (${error || `HTTP ${status}`}).` };
    }
  }

  submitContext(e) {
    e?.preventDefault();
    const org = (this._orgInput || '').trim();
    const site = (this._siteInput || '').trim();
    if (!org || !site) {
      this._message = { type: 'error', text: 'Enter both an org and a site.' };
      return;
    }
    if (this._dirty
      // eslint-disable-next-line no-alert
      && !window.confirm('Discard unsaved changes and switch site?')) return;
    this.load(org, site);
  }

  // --- rendering ---
  renderContextBar() {
    return html`
      <form class="dac-context" @submit=${(e) => this.submitContext(e)}>
        <label>Org
          <input type="text" .value=${this._orgInput}
            @input=${(e) => { this._orgInput = e.target.value; }} placeholder="org" />
        </label>
        <label>Site
          <input type="text" list="dac-sites" .value=${this._siteInput}
            @input=${(e) => { this._siteInput = e.target.value; }} placeholder="site" />
          <datalist id="dac-sites">
            ${this._siteList.map((s) => html`<option value=${s}></option>`)}
          </datalist>
        </label>
        <button type="submit" class="dac-btn">Load</button>
      </form>`;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="dac-msg dac-msg-${this._message.type}">
      ${msgIcon(this._message.type)}
      <span>${this._message.text}</span>
    </div>`;
  }

  renderSummary() {
    const v = this._validation;
    if (!v) return nothing;
    const countKeys = (rows, prop) => rows.reduce((n, r) => n + Object.keys(r[prop]).length, 0);
    const errs = v.globalErrors.length + countKeys(v.rows, 'errors');
    const warns = v.globalWarnings.length + countKeys(v.rows, 'warnings');
    return html`<div class="dac-summary">
      ${errs ? html`<span class="dac-badge dac-badge-error">${icon('error')} ${errs} error${errs > 1 ? 's' : ''}</span>` : nothing}
      ${warns ? html`<span class="dac-badge dac-badge-warning">${icon('warning')} ${warns} warning${warns > 1 ? 's' : ''}</span>` : nothing}
      ${!errs && !warns ? html`<span class="dac-badge dac-badge-ok">${icon('check')} No issues</span>` : nothing}
      ${v.globalErrors.map((m) => html`<div class="dac-global dac-global-error">${m}</div>`)}
      ${v.globalWarnings.map((m) => html`<div class="dac-global dac-global-warning">${m}</div>`)}
    </div>`;
  }

  renderRow(row, i) {
    const rr = this._validation?.rows?.[i] || { errors: {}, warnings: {} };
    const ro = this._readOnly;
    const cls = (key) => {
      if (rr.errors?.[key]) return 'dac-cell has-error';
      if (rr.warnings?.[key]) return 'dac-cell has-warning';
      return 'dac-cell';
    };
    return html`
      <tr class=${rr.ignored ? 'dac-row-ignored' : ''}>
        <td class=${cls('path')}>
          <input type="text" .value=${row.path || ''} ?disabled=${ro}
            @input=${(e) => this.updateCell(i, 'path', e.target.value)} placeholder="/section/**" />
          ${renderCellMsg(rr, 'path')}
        </td>
        <td class=${cls('tier')}>
          <select ?disabled=${ro} @change=${(e) => this.updateCell(i, 'tier', e.target.value)}>
            ${TIERS.map((t) => html`<option value=${t} ?selected=${(row.tier || '').trim().toLowerCase() === t}>${t}</option>`)}
          </select>
          ${renderCellMsg(rr, 'tier')}
        </td>
        <td class=${cls('audience')}>
          <input type="text" .value=${row.audience || ''} ?disabled=${ro}
            list="dac-audiences"
            @input=${(e) => this.updateCell(i, 'audience', e.target.value)} placeholder="audience, audience" />
          ${renderCellMsg(rr, 'audience')}
        </td>
        <td class=${cls('description')}>
          <input type="text" .value=${row.description || ''} ?disabled=${ro}
            @input=${(e) => this.updateCell(i, 'description', e.target.value)} placeholder="(optional) human note" />
        </td>
        <td class="dac-actions">
          ${ro ? nothing : html`<button class="dac-iconbtn" title="Remove row"
            @click=${() => this.removeRow(i)} aria-label="Remove row">${icon('remove')}</button>`}
        </td>
      </tr>`;
  }

  renderTable() {
    const audiences = collectAudiences(this._rows);
    return html`
      <datalist id="dac-audiences">
        ${audiences.map((a) => html`<option value=${a}></option>`)}
      </datalist>
      <table class="dac-table">
        <thead>
          <tr>
            <th>Path</th><th>Tier</th><th>Audience</th><th>Description</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${this._rows.length
    ? this._rows.map((row, i) => this.renderRow(row, i))
    : html`<tr><td colspan="5" class="dac-empty">No policy rows yet. Add one to get started.</td></tr>`}
        </tbody>
      </table>`;
  }

  renderToolbar() {
    const hasErrors = this._validation?.hasErrors;
    return html`
      <div class="dac-toolbar">
        <h1>Access Control${this._org ? html` <span class="dac-scope">${this._org}/${this._site}</span>` : nothing}</h1>
        <div class="dac-toolbar-actions">
          ${this._org && this._state === 'ready' ? html`
            <button class="dac-btn" ?disabled=${this._publishing || this._dirty}
              title=${this._dirty ? 'Save your changes before publishing.' : 'Re-read, validate, sign and push the policy to the access-control worker.'}
              @click=${() => this.publish()}>${this._publishing ? 'Publishing…' : 'Publish to worker'}</button>` : nothing}
          ${this._readOnly ? html`<span class="dac-readonly">Read only</span>` : html`
            <button class="dac-btn" ?disabled=${this._saving} @click=${() => this.addRow()}>${icon('add')} Add row</button>
            <button class="dac-btn dac-btn-primary" ?disabled=${this._saving || hasErrors || !this._dirty}
              @click=${() => this.save()}>${this._saving ? 'Saving…' : 'Save'}</button>`}
        </div>
      </div>`;
  }

  renderContent() {
    if (this._state === 'idle') {
      return html`<p class="dac-hint">Enter an org and site above to manage its visitor access-control policy.</p>`;
    }
    if (this._state === 'loading') return html`<p class="dac-hint">Loading…</p>`;
    if (this._state === 'error') return nothing;
    return html`
      ${this.renderSummary()}
      ${this.renderTable()}`;
  }

  render() {
    return html`
      ${this.renderToolbar()}
      ${this.renderContextBar()}
      ${this.renderMessage()}
      <div class="dac-body">${this.renderContent()}</div>`;
  }
}

customElements.define('da-access-control-app', DaAccessControlApp);

(async function init() {
  let context = {};
  let token = '';
  // DA_SDK resolves only inside the da.live parent frame. Race it against a timeout so
  // the UI still renders (driven by ?org=&site=) if the handshake stalls or is absent.
  try {
    const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), 3000); });
    const sdk = await Promise.race([DA_SDK, timeout]);
    if (sdk) ({ context, token } = sdk);
    else console.warn('[da-access-control] DA SDK did not resolve; falling back to URL params.');
  } catch (e) {
    console.warn('[da-access-control] DA SDK unavailable:', e);
  }
  const cmp = document.createElement('da-access-control-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
