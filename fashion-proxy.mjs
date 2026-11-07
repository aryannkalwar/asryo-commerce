// Narrow same-origin gateway for ASRYO Fashion OS. Only the listed internal routes
// are forwarded; storefront, checkout, customers, public catalog and /admin remain local.
import { Readable } from 'node:stream';

const PLATFORM_ORIGIN = 'https://asryo-vercel-storefront.vercel.app';
const HTML_ROUTES = new Set([
  '/workspace', '/fashion-os', '/dashboard', '/studio', '/operations', '/manufacturing',
  '/workspace.html', '/dashboard.html', '/operations.html', '/team.html',
]);
const PRIVATE_API_ROUTES = new Set(['/api/control','/api/team','/api/ops','/api/creative']);
const REQUEST_HEADER_BLOCK = new Set([
  'host','connection','transfer-encoding','content-length','accept-encoding',
  'x-forwarded-host','x-forwarded-proto','x-forwarded-port','x-forwarded-for',
  'cf-connecting-ip','cf-ray','cf-ipcountry','cf-visitor',
  'x-vercel-id','x-vercel-forwarded-for','x-real-ip',
]);

export function isFashionOSPath(path) {
  return HTML_ROUTES.has(path) || PRIVATE_API_ROUTES.has(path);
}

function sendError(res, status, error) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({error}));
}

export async function proxyFashionOS(req, res, path, publicOrigin) {
  if (!isFashionOSPath(path)) return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    sendError(res, 405, 'Method not allowed');
    return true;
  }

  // Reject cross-site writes on the public domain BEFORE replacing Origin for
  // the internal Vercel hop. Browsers send Origin on sensitive requests.
  if (!['GET', 'HEAD'].includes(method)) {
    const origin = String(req.headers.origin || '');
    const expected = process.env.APP_ORIGIN
      ? new URL(process.env.APP_ORIGIN).origin
      : publicOrigin;
    if (origin !== expected) {
      sendError(res, 403, 'Request origin rejected');
      return true;
    }
  }

  try {
    const target = new URL(req.url, PLATFORM_ORIGIN);
    if (target.origin !== PLATFORM_ORIGIN || !isFashionOSPath(target.pathname)) {
      sendError(res, 400, 'Invalid internal route');
      return true;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (REQUEST_HEADER_BLOCK.has(name.toLowerCase()) || value === undefined) continue;
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else headers.set(name, value);
    }
    // The server verifies browser Origin above; Vercel validates its own host.
    if (!['GET', 'HEAD'].includes(method)) headers.set('origin', PLATFORM_ORIGIN);

    const upstream = await fetch(target, {
      method, headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : req,
      ...(method === 'GET' || method === 'HEAD' ? {} : {duplex: 'half'}),
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
    });

    res.statusCode = upstream.status;
    for (const name of ['content-type','content-disposition','retry-after','www-authenticate']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);

    const location = upstream.headers.get('location');
    if (location) {
      const to = new URL(location, PLATFORM_ORIGIN);
      // Keep a same-origin Vercel redirect inside the user's asryo.com site.
      res.setHeader('Location', to.origin === PLATFORM_ORIGIN ? to.pathname + to.search + to.hash : location);
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Current Fashion OS uses inline scripts. Restrict this exception to
    // private workspace routes; the public storefront keeps its strict CSP.
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
      "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self'");

    if (!upstream.body || method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
      res.end(); return true;
    }

    await new Promise((resolve, reject) => {
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', reject);
      res.on('close', resolve);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  } catch (err) {
    if (res.headersSent) res.destroy();
    else {
      console.error('asryo_fashion_proxy_error', {type: err?.name || 'Error'});
      sendError(res, 502, 'Private workspace temporarily unavailable');
    }
  }
  return true;
}
