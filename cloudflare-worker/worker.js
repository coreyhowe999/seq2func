// Cloudflare Worker to proxy seq2func.win → Cloud Run
// Rewrites the Host header so Cloud Run accepts the request
const CLOUD_RUN_URL = 'https://seq2func-web-882604240527.us-central1.run.app';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = CLOUD_RUN_URL + url.pathname + url.search;

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return fetch(modifiedRequest);
  },
};
