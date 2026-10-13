/* Campaign-level counts only: no cookies, storage, visitor IDs or page contents. */
(() => {
  'use strict';
  const endpoint = 'https://giwwi.app.n8n.cloud/webhook/attention-campaign-event-v1-1bc81b89b9b64888';
  if (Date.now() >= Date.parse('2026-10-27T00:00:00+01:00')) return;
  const params = new URLSearchParams(location.search);
  const source = params.get('utm_source');
  const content = params.get('utm_content') || '';
  const campaign = params.get('utm_campaign');
  if (!['x', 'bluesky', 'devto'].includes(source) || params.get('utm_medium') !== 'social') return;
  if (campaign && campaign !== 'attention_growth') return;
  if (!/^[a-z0-9][a-z0-9_-]{0,69}$/.test(content)) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  const campaignId = content.endsWith('-' + source) ? content : content + '-' + source;
  const sent = new Set();
  const send = (event) => {
    if (sent.has(event)) return;
    sent.add(event);
    const payload = JSON.stringify({ campaign_id: campaignId, event, is_test: params.get('attention_test') === '1' });
    try {
      if (navigator.sendBeacon?.(endpoint, new Blob([payload], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch { /* Navigation and video playback must never depend on analytics. */ }
    try {
      window.fetch?.(endpoint, { method: 'POST', body: payload, mode: 'no-cors', credentials: 'omit', cache: 'no-store', keepalive: true, referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {});
    } catch { /* Ignore analytics failures. */ }
  };
  const countOpen = () => { if (document.visibilityState === 'visible') send('page_open'); };
  countOpen();
  document.addEventListener('visibilitychange', countOpen);
  document.querySelector('#attention-demo')?.addEventListener('play', () => send('demo_start'));
  document.querySelectorAll('a[href^="https://chromewebstore.google.com/detail/attention/"]').forEach(link => link.addEventListener('click', () => send('install_click')));
})();
