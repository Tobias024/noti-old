export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const ghPath = url.pathname.replace(/^\/api\/gh/, '');
  if (!ghPath || !ghPath.startsWith('/')) {
    return json({ message: 'Bad proxy path' }, 400);
  }
  const ghUrl = 'https://api.github.com' + ghPath + url.search;

  const fwd = new Headers();
  fwd.set('Accept', req.headers.get('accept') || 'application/vnd.github+json');
  fwd.set('User-Agent', 'noti-old-proxy');
  const auth = req.headers.get('authorization');
  if (auth) fwd.set('Authorization', auth);
  const ct = req.headers.get('content-type');
  if (ct) fwd.set('Content-Type', ct);

  const init = { method: req.method, headers: fwd };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  let upstream;
  try {
    upstream = await fetch(ghUrl, init);
  } catch (e) {
    return json({ message: 'Upstream error: ' + (e && e.message ? e.message : String(e)) }, 502);
  }

  const body = await upstream.text();
  const headers = Object.assign({}, CORS, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json'
  });
  return new Response(body, { status: upstream.status, headers });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
  });
}
