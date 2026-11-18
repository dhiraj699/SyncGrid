/**
 * Dynamic CORS matcher supporting comma-separated origins, Vercel preview domains (*.vercel.app),
 * and development localhost on any port with credentials: true.
 */
export function createCorsOriginMatcher(rawOrigins, isProduction = false) {
  const allowed = (rawOrigins || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const allowedSet = new Set(allowed);

  return (origin, callback) => {
    // Non-browser or same-origin requests (e.g. mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    const normalized = origin.trim().replace(/\/$/, '');
    if (allowedSet.has('*') || allowedSet.has(normalized)) {
      return callback(null, true);
    }

    try {
      const url = new URL(normalized);
      // Support Vercel domains (e.g. https://*.vercel.app)
      if (allowed.some((a) => a.includes('vercel.app')) && url.hostname.endsWith('.vercel.app')) {
        return callback(null, true);
      }
      // Allow localhost in development / test
      if (!isProduction && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return callback(null, true);
      }
    } catch {
      // Invalid URL
    }

    return callback(null, false);
  };
}

