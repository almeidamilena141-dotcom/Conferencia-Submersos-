const SITE_URL = process.env.URL || 'https://conferenciasubmersos.netlify.app';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function splitName(fullName) {
  const parts = fullName.trim().replace(/\s+/g, ' ').split(' ');
  return {
    first_name: parts.shift() || '',
    last_name: parts.join(' ') || ''
  };
}

function splitPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const normalized = digits.startsWith('55') ? digits.slice(2) : digits;
  return {
    area_code: normalized.slice(0, 2),
    number: normalized.slice(2)
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return json({ error: 'A integração de pagamento ainda não foi configurada no Netlify.' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dados inválidos.' }, 400); }

  const nome = String(body.nome || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const whatsapp = String(body.whatsapp || '').trim();
  const camiseta = String(body.camiseta || '').trim().toUpperCase();
  const tamanhos = new Set(['PP', 'P', 'M', 'G', 'GG', 'XG']);

  if (nome.length < 3) return json({ error: 'Informe seu nome completo.' }, 400);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
  if (whatsapp.replace(/\D/g, '').length < 10) return json({ error: 'Informe um WhatsApp válido.' }, 400);
  if (!tamanhos.has(camiseta)) return json({ error: 'Selecione o tamanho da camiseta.' }, 400);

  const { first_name, last_name } = splitName(nome);
  const phone = splitPhone(whatsapp);
  const ticketRef = `SUBMERSOS-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;

  const orderPayload = {
    type: 'online',
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    total_amount: '100.00',
    external_reference: ticketRef,
    expiration_time: 'P1D',
    description: 'Ingresso Conferência SUBMERSOS 2026',
    payer: {
      email,
      first_name,
      last_name,
      phone
    },
    items: [
      {
        external_code: 'SUBMERSOS-2026-INGRESSO',
        title: 'Ingresso Conferência SUBMERSOS 2026',
        description: `Ingresso válido para os dois dias. Camiseta: ${camiseta}`,
        quantity: 1,
        unit_price: '100.00',
        total_amount: '100.00'
      }
    ],
    config: {
      online: {
        success_url: `${SITE_URL}/pagamento-sucesso.html`,
        failure_url: `${SITE_URL}/pagamento-falhou.html`,
        pending_url: `${SITE_URL}/pagamento-pendente.html`,
        auto_return: 'approved'
      }
    }
  };

  const response = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Idempotency-Key': crypto.randomUUID()
    },
    body: JSON.stringify(orderPayload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.checkout_url) {
    console.error('Mercado Pago create order error:', response.status, result);
    return json({ error: 'O Mercado Pago não conseguiu criar o pagamento. Tente novamente.' }, 502);
  }

  return json({
    checkout_url: result.checkout_url,
    order_id: result.id,
    ticket_ref: ticketRef,
    expiration_time: result.expiration_time || 'P1D'
  });
};

export const config = { path: '/api/criar-pagamento' };
