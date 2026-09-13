const { isIP } = require('node:net');

function isPrivateIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpLiteral(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return false;

  if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const firstHextet = Number.parseInt(normalized.split(':')[0], 16);
  return Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80;
}

// Deliberately performs URL-string checks only. It never resolves DNS or
// fetches the target, so a manual display URL cannot become an SSRF primitive.
function isPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  return !isPrivateIpLiteral(hostname);
}

module.exports = { isPublicHttpsUrl, isPrivateIpLiteral };
