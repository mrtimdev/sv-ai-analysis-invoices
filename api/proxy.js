export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Vercel Serverless Function Proxy.
 * Resolves browser Mixed Content issues when deployed on HTTPS (e.g. *.vercel.app)
 * while connecting to an HTTP backend server (e.g. http://45.201.196.19:3002).
 */
export default async function handler(req, res) {
  // 1. CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. Resolve target URL
  let targetUrl = req.query?.url || req.headers['x-target-url'];

  if (!targetUrl && req.query?.path) {
    const base = process.env.VITE_API_SERVER_BASE || 'http://45.201.196.19:3002';
    targetUrl = `${base.replace(/\/+$/, '')}/${req.query.path.replace(/^\/+/, '')}`;
  }

  if (!targetUrl) {
    res.status(400).json({
      error: 'Missing target URL',
      message: 'Provide a target via ?url=http://... or x-target-url header',
    });
    return;
  }

  // If query string has other parameters besides ?url=..., append them if not already in targetUrl
  try {
    const parsedTarget = new URL(targetUrl);
    for (const [key, val] of Object.entries(req.query || {})) {
      if (key !== 'url' && key !== 'path' && !parsedTarget.searchParams.has(key)) {
        parsedTarget.searchParams.set(key, val);
      }
    }
    targetUrl = parsedTarget.toString();
  } catch (err) {
    res.status(400).json({ error: 'Invalid target URL', details: err.message, targetUrl });
    return;
  }

  // 3. Read body buffer for non-GET/HEAD methods
  let bodyBuffer = null;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    if (chunks.length > 0) {
      bodyBuffer = Buffer.concat(chunks);
    }
  }

  // 4. Forward headers
  const forwardHeaders = {};
  const skipHeaders = new Set(['host', 'connection', 'content-length']);
  for (const [k, v] of Object.entries(req.headers || {})) {
    const lower = k.toLowerCase();
    if (!skipHeaders.has(lower) && !lower.startsWith('x-vercel')) {
      forwardHeaders[k] = v;
    }
  }

  try {
    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuffer,
      redirect: 'follow',
    });

    res.status(upstreamResp.status);

    // Forward upstream response headers
    for (const [k, v] of upstreamResp.headers.entries()) {
      const lower = k.toLowerCase();
      if (lower === 'transfer-encoding' || lower === 'content-encoding') continue;
      res.setHeader(k, v);
    }

    const arrayBuffer = await upstreamResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).json({
      error: 'Proxy gateway error: unable to reach target backend',
      targetUrl,
      details: err.message,
    });
  }
}
