import { createHmac, timingSafeEqual } from 'node:crypto';

function hexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch { return false; }
}

function parseSignature(header) {
  const parts = String(header || '').split(',');
  const out = {};
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) out[key.trim()] = rest.join('=').trim();
  }
  return out;
}

async function sendTicketEmail(order) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { skipped: true };

  const ref = order.external_reference;
  const site = process.env.URL || 'https://conferenciasubmersos.netlify.app';
  const ticketUrl = `${site}/ingresso.html?ref=${encodeURIComponent(ref)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(`${site}/check-in.html?ticket=${ref}`)}`;
  const payer = order.payer || {};
  const item = order.items?.[0] || {};
  const shirtMatch = String(item.description || '').match(/Camiseta:\s*([A-Z0-9]+)/i);
  const camiseta = shirtMatch ? shirtMatch[1].toUpperCase() : '—';
  const nome = [payer.first_name, payer.last_name].filter(Boolean).join(' ') || 'Participante';

  const html = `<!doctype html><html><body style="margin:0;background:#07111c;color:#fff;font-family:Arial,sans-serif;padding:28px"><div style="max-width:620px;margin:auto;background:#0c1a27;border:1px solid #7f6a3d;border-radius:18px;padding:28px;text-align:center"><div style="font-size:13px;letter-spacing:4px;color:#d8b568">CONFERÊNCIA DE JOVENS</div><h1 style="font-size:46px;letter-spacing:3px;color:#d8b568;margin:12px 0">SUBMERSOS</h1><p style="color:#d8d8d8">Profundidade, constância e intimidade eterna</p><hr style="border:0;border-top:1px solid #334454;margin:24px 0"><p style="font-size:20px">Olá, <strong>${nome}</strong>! Seu pagamento foi confirmado.</p><p style="color:#cfcfcf">Ingresso: R$ 100,00 • Camiseta: ${camiseta}</p><img src="${qrUrl}" alt="QR Code do ingresso SUBMERSOS" width="280" height="280" style="background:#fff;padding:10px;border-radius:12px"><p style="font-size:13px;color:#b9c0c6">Apresente este QR Code no check-in.</p><a href="${ticketUrl}" style="display:inline-block;background:#d8b568;color:#080d12;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:10px">Abrir meu ingresso</a><p style="margin-top:24px;font-size:12px;color:#8995a0">20 e 21 de novembro • Igreja Eleitos em Cristo</p></div></body></html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `submersos-ticket-${ref}`
    },
    body: JSON.stringify({
      from,
      to: [payer.email],
      subject: 'Seu ingresso — Conferência SUBMERSOS 🌊',
      html
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend: ${JSON.stringify(result)}`);
  return { sent: true, id: result.id };
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const url = new URL(req.url);
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  const requestId = req.headers.get('x-request-id') || '';
  const signatureHeader = req.headers.get('x-signature') || '';

  if (secret) {
    const parsed = parseSignature(signatureHeader);
    const manifestParts = [];
    if (dataId) manifestParts.push(`id:${dataId}`);
    if (requestId) manifestParts.push(`request-id:${requestId}`);
    if (parsed.ts) manifestParts.push(`ts:${parsed.ts}`);
    const manifest = manifestParts.length ? `${manifestParts.join(';')};` : '';
    const calculated = createHmac('sha256', secret).update(manifest).digest('hex');
    if (!hexEqual(calculated, parsed.v1)) return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => ({}));
  if (payload.type !== 'order') return new Response('OK', { status: 200 });
  const orderId = payload.data?.id;
  if (!orderId) return new Response('OK', { status: 200 });

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return new Response('Server not configured', { status: 500 });

  const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  });
  const order = await response.json().catch(() => ({}));
  if (!response.ok) return new Response('Could not fetch order', { status: 502 });

  if (order.status === 'processed' && Number(order.total_paid_amount) >= 100) {
    try {
      await sendTicketEmail(order);
    } catch (error) {
      console.error('Ticket email error:', error);
    }
  }

  return new Response('OK', { status: 200 });
};

export const config = { path: '/api/webhook-mercadopago' };
