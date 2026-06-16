const API_BASE = import.meta.env.PROD ? '' : '';

export async function fetchResolvers() {
  const res = await fetch(`${API_BASE}/api/resolvers`);
  if (!res.ok) throw new Error('Failed to fetch resolvers');
  return res.json();
}

export async function verifyCanary(domain) {
  const res = await fetch(`${API_BASE}/api/dns/verify-canary?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) return { verified: false };
  return res.json();
}

export async function verifyCloudflare(domain) {
  const res = await fetch(`${API_BASE}/api/dns/verify?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) return { verified: false };
  return res.json();
}

export async function submitTelemetry(payload) {
  const res = await fetch(`${API_BASE}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}
