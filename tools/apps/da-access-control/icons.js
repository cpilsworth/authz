/* eslint-disable import/no-unresolved */
import { html } from 'da-lit';

// Minimal inline SVG icon set (no external requests inside the da.live iframe).
const ICONS = {
  add: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16.5 8.25h-6.75V1.5a.75.75 0 0 0-1.5 0v6.75H1.5a.75.75 0 0 0 0 1.5h6.75v6.75a.75.75 0 0 0 1.5 0V9.75h6.75a.75.75 0 0 0 0-1.5z"/></svg>`,
  remove: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15.75 3h-3.5l-.46-1.36A.75.75 0 0 0 11.08 1H6.92a.75.75 0 0 0-.71.51L5.75 3H2.25a.75.75 0 0 0 0 1.5h.62l.78 11a1.25 1.25 0 0 0 1.25 1.16h8.2a1.25 1.25 0 0 0 1.25-1.16l.78-11h.62a.75.75 0 0 0 0-1.5zM7.5 13.5a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0zm4.5 0a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0z"/></svg>`,
  error: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 1a8 8 0 1 0 8 8 8 8 0 0 0-8-8zm0 12.25a1 1 0 1 1 1-1 1 1 0 0 1-1 1zm.9-3.6a.9.9 0 0 1-1.8 0v-4.4a.9.9 0 0 1 1.8 0z"/></svg>`,
  warning: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16.86 14.2 10.2 2.06a1.37 1.37 0 0 0-2.4 0L1.14 14.2a1.37 1.37 0 0 0 1.2 2.05h13.32a1.37 1.37 0 0 0 1.2-2.05zM8.1 6.2a.9.9 0 0 1 1.8 0v4a.9.9 0 0 1-1.8 0zM9 14a1 1 0 1 1 1-1 1 1 0 0 1-1 1z"/></svg>`,
  check: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15.55 4.22 7.06 14.06a.75.75 0 0 1-1.12.04L2.4 10.6a.75.75 0 1 1 1.06-1.06l2.95 2.95 7.97-9.24a.75.75 0 1 1 1.17.97z"/></svg>`,
};

export default function icon(name) {
  return ICONS[name] || null;
}
