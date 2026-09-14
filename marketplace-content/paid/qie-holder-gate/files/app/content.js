// What members see once they are in. Replace it with your own.
//
// This page runs in the visitor's browser, so anything written here can be
// read by anyone who opens the source. Use it for perks and member-facing
// pages; for content that must stay secret, serve it from a server that checks
// the same signature and holdings (see README.md).

import { html } from "htm/preact";
import { explorerAddress } from "./contract.js";

export function MembersContent({ account }) {
  return html`
    <section class="panel">
      <h2>Welcome in</h2>
      <p>
        Signed in as <a href=${explorerAddress(account)} target="_blank" rel="noreferrer">${account}</a>.
      </p>
      <div class="grid">
        <div class="card">
          <div class="label">Community call</div>
          <p>Every Thursday. Put your meeting link here.</p>
        </div>
        <div class="card">
          <div class="label">Early access</div>
          <p>Link the beta, the allowlist form or the drop that members get first.</p>
        </div>
        <div class="card">
          <div class="label">Member chat</div>
          <p>Your Telegram or Discord invite goes here.</p>
        </div>
      </div>
    </section>
  `;
}
