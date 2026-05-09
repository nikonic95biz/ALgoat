/**
 * AURAPOINTS — frontend config (edit & redeploy, or swap in CI).
 *
 * apiBase     — Your Node backend URL (Railway / Fly / VPS). Must be https in production.
 *              Leave empty to use demo mode (fake X login on this site only).
 * tweetIds    — Map our card id → X numeric status id from the tweet URL
 *              e.g. https://x.com/you/status/1234567890123456789  → 1234567890123456789
 */
window.AURAPOINTS = window.AURAPOINTS || {};
window.AURAPOINTS.apiBase = 'https://zucchini-commitment-production-71cf.up.railway.app';

window.AURAPOINTS.tweetIds = {
  t1: '',
  t2: '',
  t3: '',
};
