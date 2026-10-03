function hexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  try {
    const aa = new Uint8Array(a.match(/.{1,2}/g).map(x => parseInt(x, 16)));
    const bb = new Uint8Array(b.match(/.{1,2}/g).map(x => parseInt(x, 16)));

    if (aa.length !== bb.length) return false;

    let result = 0;

    for (let i = 0; i < aa.length; i++) {
      result |= aa[i] ^ bb[i];
    }

    return result === 0;
  } catch {
    return false;
  }
}

function parseSignature(header) {
  const parts = String(header || '').split(',');
  const out = {};

  for (const part of parts) {
    const [key, ...rest] = part.split('=');

    if (key && rest.length) {
      out[key.trim()] = rest.join('=').trim();
    }
  }

  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createHmac(secret, message) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );

  return bytesToHex(new Uint8Array(signature));
}

async function sendTicketEmail(order, env) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log('Resend não configurado. E-mail não enviado.');
    return { skipped: true };
  }

  const ref = order.external_reference;

  const site =
    env.SITE_URL ||
    'https://conferencia-submersos.milenasant2204.workers.dev';

  const ticketUrl =
    `${site}/ingresso.html?ref=${encodeURIComponent(ref)}`;

  const qrUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(
      `${site}/check-in.html?ticket=${ref}`
    )}`;

  const payer = order.payer || {};
  const item = order.items?.[0] || {};

  const shirtMatch =
    String(item.description || '')
      .match(/Camiseta:\s*([A-Z0-9]+)/i);

  const camiseta =
    shirtMatch
      ? shirtMatch[1].toUpperCase()
      : '—';

  const nome =
    [payer.first_name, payer.last_name]
      .filter(Boolean)
      .join(' ') || 'Participante';

  const email = payer.email;

  if (!email) {
    console.log('Pedido sem e-mail do participante.');
    return { skipped: true };
  }

  const html = `
<!doctype html>
<html>
<body style="margin:0;background:#07111c;color:#fff;font-family:Arial,sans-serif;padding:28px">

<div style="max-width:620px;margin:auto;background:#0c1a27;border:1px solid #7f6a3d;border-radius:18px;padding:28px;text-align:center">

<div style="font-size:13px;letter-spacing:4px;color:#d8b568">
CONFERÊNCIA DE JOVENS
</div>

<h1 style="font-size:46px;letter-spacing:3px;color:#d8b568;margin:12px 0">
SUBMERSOS
</h1>

<p style="color:#d8d8d8">
Profundidade, constância e intimidade eterna
</p>

<hr style="border:0;border-top:1px solid #334454;margin:24px 0">

<p style="font-size:20px">
Olá, <strong>${nome}</strong>!
Seu pagamento foi confirmado.
</p>

<p style="color:#cfcfcf">
Ingresso: R$ 100,00 • Camiseta: ${camiseta}
</p>

<img
  src="${qrUrl}"
  alt="QR Code do ingresso SUBMERSOS"
  width="280"
  height="280"
  style="background:#fff;padding:10px;border-radius:12px"
>

<p style="font-size:13px;color:#b9c0c6">
Apresente este QR Code no check-in.
</p>

<a
  href="${ticketUrl}"
  style="display:inline-block;background:#d8b568;color:#080d12;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:10px"
>
Abrir meu ingresso
</a>

<p style="margin-top:24px;font-size:12px;color:#8995a0">
20 e 21 de novembro • Igreja Eleitos em Cristo
</p>

</div>
</body>
</html>
`;

  const response = await fetch(
    'https://api.resend.com/emails',
    {
      method: 'POST',

      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `submersos-ticket-${ref}`
      },

      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Seu ingresso — Conferência SUBMERSOS 🌊',
        html
      })
    }
  );

  const result =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Resend: ${JSON.stringify(result)}`
    );
  }

  return {
    sent: true,
    id: result.id
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret =
    env.MERCADOPAGO_WEBHOOK_SECRET;

  const url = new URL(request.url);

  const dataId =
    (
      url.searchParams.get('data.id') || ''
    ).toLowerCase();

  const requestId =
    request.headers.get('x-request-id') || '';

  const signatureHeader =
    request.headers.get('x-signature') || '';

  if (secret) {
    const parsed =
      parseSignature(signatureHeader);

    const manifestParts = [];

    if (dataId) {
      manifestParts.push(`id:${dataId}`);
    }

    if (requestId) {
      manifestParts.push(
        `request-id:${requestId}`
      );
    }

    if (parsed.ts) {
      manifestParts.push(
        `ts:${parsed.ts}`
      );
    }

    const manifest =
      manifestParts.length
        ? `${manifestParts.join(';')};`
        : '';

    const calculated =
      await createHmac(
        secret,
        manifest
      );

    if (
      !hexEqual(
        calculated,
        parsed.v1
      )
    ) {
      return new Response(
        'Unauthorized',
        { status: 401 }
      );
    }
  }

  const payload =
    await request.json().catch(() => ({}));

  if (payload.type !== 'order') {
    return new Response(
      'OK',
      { status: 200 }
    );
  }

  const orderId =
    payload.data?.id;

  if (!orderId) {
    return new Response(
      'OK',
      { status: 200 }
    );
  }

  const accessToken =
    env.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      'MERCADOPAGO_ACCESS_TOKEN não configurado.'
    );

    return new Response(
      'Server not configured',
      { status: 500 }
    );
  }

  const response = await fetch(
    `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        'Authorization':
          `Bearer ${accessToken}`,

        'Accept':
          'application/json'
      }
    }
  );

  const order =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'Erro ao consultar pedido:',
      order
    );

    return new Response(
      'Could not fetch order',
      { status: 502 }
    );
  }

  console.log(
    'Mercado Pago webhook recebido:',
    {
      orderId,
      status: order.status
    }
  );

  if (
    order.status === 'processed' &&
    Number(order.total_paid_amount) >= 100
  ) {
    try {
      await sendTicketEmail(
        order,
        env
      );
    } catch (error) {
      console.error(
        'Erro ao enviar ingresso:',
        error
      );
    }
  }

  return new Response(
    'OK',
    { status: 200 }
  );
}
