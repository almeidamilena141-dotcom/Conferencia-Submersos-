const SITE_URL = process.env.URL || 'https://conferenciasubmersos.netlify.app';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default async (req) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const ref = new URL(req.url).searchParams.get('ref');
  if (!accessToken || !ref) return json({ error: 'Ingresso não encontrado.' }, 404);

  const response = await fetch(`https://api.mercadopago.com/v1/orders?external_reference=${encodeURIComponent(ref)}&limit=1`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: 'Não foi possível consultar o ingresso.' }, 502);

  const order = result.results?.[0] || result.orders?.[0] || result.data?.[0];
  if (!order || order.status !== 'processed' || Number(order.total_paid_amount) < 100) {
    return json({ error: 'O pagamento ainda não foi confirmado.', status: order?.status || 'not_found' }, 409);
  }

  const payer = order.payer || {};
  const item = order.items?.[0] || {};
  const shirtMatch = String(item.description || '').match(/Camiseta:\s*([A-Z0-9]+)/i);
  const camiseta = shirtMatch ? shirtMatch[1].toUpperCase() : '—';
  const nome = [payer.first_name, payer.last_name].filter(Boolean).join(' ') || 'Participante';
  const checkinUrl = `${SITE_URL}/check-in.html?ticket=${encodeURIComponent(ref)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(checkinUrl)}`;

  return json({
    ok: true,
    nome,
    email: payer.email || '',
    camiseta,
    order_id: order.id,
    ticket_ref: ref,
    qr_url: qrUrl,
    checkin_url: checkinUrl
  });
};

export const config = { path: '/api/ingresso' };
