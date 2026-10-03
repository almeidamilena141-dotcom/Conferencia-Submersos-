import { createHmac, timingSafeEqual } from 'node:crypto';

function hexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(a, 'hex'),
      Buffer.from(b, 'hex')
    );
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

async function sendTicketEmail(order) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  // Se o Resend ainda não estiver configurado,
  // não impede o processamento do pagamento.
  if (!apiKey || !from) {
    console.log('Webhook MP: envio de e-mail ignorado — Resend não configurado.');
    return { skipped: true };
  }

  const ref = order.external_reference;

  const site =
    process.env.URL ||
    'https://conferenciasubmersos.netlify.app';

  const ticketUrl =
    `${site}/ingresso.html?ref=${encodeURIComponent(ref)}`;

  const checkInUrl =
    `${site}/check-in.html?ticket=${encodeURIComponent(ref)}`;

  const qrUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${encodeURIComponent(checkInUrl)}`;

  const payer = order.payer || {};
  const item = order.items?.[0] || {};

  const shirtMatch = String(item.description || '')
    .match(/Camiseta:\s*([A-Z0-9]+)/i);

  const camiseta = shirtMatch
    ? shirtMatch[1].toUpperCase()
    : '—';

  const nome =
    [payer.first_name, payer.last_name]
      .filter(Boolean)
      .join(' ') ||
    'Participante';

  const email = payer.email;

  if (!email) {
    console.error('Webhook MP: pedido sem e-mail do participante.');
    return { skipped: true, reason: 'missing_email' };
  }

  const html = `
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Ingresso SUBMERSOS</title>
</head>

<body style="
  margin:0;
  background:#07111c;
  color:#fff;
  font-family:Arial,sans-serif;
  padding:28px;
">

  <div style="
    max-width:620px;
    margin:auto;
    background:#0c1a27;
    border:1px solid #7f6a3d;
    border-radius:18px;
    padding:28px;
    text-align:center;
  ">

    <div style="
      font-size:13px;
      letter-spacing:4px;
      color:#d8b568;
    ">
      CONFERÊNCIA DE JOVENS
    </div>

    <h1 style="
      font-size:46px;
      letter-spacing:3px;
      color:#d8b568;
      margin:12px 0;
    ">
      SUBMERSOS
    </h1>

    <p style="color:#d8d8d8;">
      Profundidade, constância e intimidade eterna
    </p>

    <hr style="
      border:0;
      border-top:1px solid #334454;
      margin:24px 0;
    ">

    <p style="font-size:20px;">
      Olá, <strong>${nome}</strong>!
    </p>

    <p style="font-size:18px;">
      Seu pagamento foi confirmado. 🎉
    </p>

    <p style="color:#cfcfcf;">
      Ingresso: R$ 100,00
      <br>
      Camiseta: ${camiseta}
    </p>

    <img
      src="${qrUrl}"
      alt="QR Code do ingresso SUBMERSOS"
      width="280"
      height="280"
      style="
        background:#fff;
        padding:10px;
        border-radius:12px;
      "
    >

    <p style="
      font-size:13px;
      color:#b9c0c6;
    ">
      Apresente este QR Code no check-in.
    </p>

    <a
      href="${ticketUrl}"
      style="
        display:inline-block;
        background:#d8b568;
        color:#080d12;
        text-decoration:none;
        font-weight:bold;
        padding:14px 22px;
        border-radius:10px;
      "
    >
      Abrir meu ingresso
    </a>

    <p style="
      margin-top:24px;
      font-size:12px;
      color:#8995a0;
    ">
      20 e 21 de novembro de 2026
      <br>
      Igreja Eleitos em Cristo
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

  console.log('Webhook MP: ingresso enviado por e-mail.');

  return {
    sent: true,
    id: result.id
  };
}


export default async (req) => {

  /*
   * ---------------------------------------------------------
   * 1. ACEITAR APENAS POST
   * ---------------------------------------------------------
   */

  if (req.method !== 'POST') {
    return new Response('OK', {
      status: 200
    });
  }


  /*
   * ---------------------------------------------------------
   * 2. VARIÁVEIS DO WEBHOOK
   * ---------------------------------------------------------
   */

  const secret =
    process.env.MERCADOPAGO_WEBHOOK_SECRET;

  const url = new URL(req.url);

  const dataId =
    (
      url.searchParams.get('data.id') || ''
    ).toLowerCase();

  const requestId =
    req.headers.get('x-request-id') || '';

  const signatureHeader =
    req.headers.get('x-signature') || '';


  /*
   * ---------------------------------------------------------
   * 3. LOG SEGURO
   * ---------------------------------------------------------
   *
   * Não mostramos Access Token nem Webhook Secret.
   */

  console.log('Webhook MP:', {
    method: req.method,
    hasSecret: Boolean(secret),
    hasSignature: Boolean(signatureHeader),
    hasRequestId: Boolean(requestId),
    dataId: dataId || null
  });


  /*
   * ---------------------------------------------------------
   * 4. VALIDAR ASSINATURA DO MERCADO PAGO
   * ---------------------------------------------------------
   */

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
      createHmac('sha256', secret)
        .update(manifest)
        .digest('hex');

    const valid =
      hexEqual(
        calculated,
        parsed.v1
      );

    if (!valid) {

      console.error(
        'Webhook MP: assinatura inválida.'
      );

      return new Response(
        'Unauthorized',
        { status: 401 }
      );
    }

    console.log(
      'Webhook MP: assinatura válida.'
    );
  }


  /*
   * ---------------------------------------------------------
   * 5. LER PAYLOAD
   * ---------------------------------------------------------
   */

  const payload =
    await req.json().catch(() => ({}));

  console.log('Webhook MP: evento recebido.', {
    type: payload.type || null,
    action: payload.action || null,
    liveMode:
      typeof payload.live_mode === 'boolean'
        ? payload.live_mode
        : null
  });


  /*
   * ---------------------------------------------------------
   * 6. IGNORAR EVENTOS QUE NÃO SÃO ORDER
   * ---------------------------------------------------------
   */

  if (payload.type !== 'order') {

    console.log(
      'Webhook MP: evento ignorado — não é order.'
    );

    return new Response('OK', {
      status: 200
    });
  }


  /*
   * ---------------------------------------------------------
   * 7. PEGAR ID DO PEDIDO
   * ---------------------------------------------------------
   */

  const orderId =
    payload.data?.id;

  if (!orderId) {

    console.log(
      'Webhook MP: evento sem data.id.'
    );

    return new Response('OK', {
      status: 200
    });
  }

  console.log(
    'Webhook MP: consultando pedido.',
    { orderId }
  );


  /*
   * ---------------------------------------------------------
   * 8. VERIFICAR ACCESS TOKEN
   * ---------------------------------------------------------
   */

  const accessToken =
    process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {

    console.error(
      'Webhook MP: MERCADOPAGO_ACCESS_TOKEN não configurado.'
    );

    return new Response(
      'Server not configured',
      { status: 500 }
    );
  }


  /*
   * ---------------------------------------------------------
   * 9. CONSULTAR PEDIDO NO MERCADO PAGO
   * ---------------------------------------------------------
   */

  let response;

  try {

    response = await fetch(
      `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
      {
        method: 'GET',

        headers: {
          'Authorization':
            `Bearer ${accessToken}`,

          'Accept':
            'application/json'
        }
      }
    );

  } catch (error) {

    console.error(
      'Webhook MP: erro ao conectar com Mercado Pago.',
      error
    );

    return new Response(
      'Mercado Pago connection error',
      { status: 502 }
    );
  }


  /*
   * ---------------------------------------------------------
   * 10. LOG DO RETORNO DA API
   * ---------------------------------------------------------
   */

  console.log(
    'Webhook MP: Mercado API status.',
    response.status
  );


  /*
   * ---------------------------------------------------------
   * 11. LER RESPOSTA
   * ---------------------------------------------------------
   */

  const order =
    await response.json().catch(() => ({}));


  /*
   * ---------------------------------------------------------
   * 12. PEDIDO NÃO EXISTE
   * ---------------------------------------------------------
   *
   * O teste do Mercado Pago pode usar um ID fictício.
   * Nesse caso, o webhook recebeu corretamente a requisição,
   * mas não existe um pedido real para consultar.
   *
   * Retornamos 200 para confirmar que o endpoint funciona.
   */

  if (response.status === 404) {

    console.log(
      'Webhook MP: pedido não encontrado. Isso pode ocorrer durante o teste do Mercado Pago.',
      { orderId }
    );

    return new Response('OK', {
      status: 200
    });
  }


  /*
   * ---------------------------------------------------------
   * 13. ACCESS TOKEN INVÁLIDO
   * ---------------------------------------------------------
   */

  if (
    response.status === 401 ||
    response.status === 403
  ) {

    console.error(
      'Webhook MP: Mercado Pago rejeitou o Access Token.',
      {
        status: response.status
      }
    );

    return new Response(
      'Mercado Pago authentication error',
      { status: 502 }
    );
  }


  /*
   * ---------------------------------------------------------
   * 14. OUTROS ERROS DA API
   * ---------------------------------------------------------
   */

  if (!response.ok) {

    console.error(
      'Webhook MP: erro ao consultar pedido.',
      {
        status: response.status,
        error:
          order?.message ||
          order?.error ||
          'Erro desconhecido'
      }
    );

    return new Response(
      'Could not fetch order',
      { status: 502 }
    );
  }


  /*
   * ---------------------------------------------------------
   * 15. VERIFICAR PAGAMENTO
   * ---------------------------------------------------------
   */

  console.log(
    'Webhook MP: pedido encontrado.',
    {
      status: order.status,
      totalPaid:
        order.total_paid_amount ?? null,
      externalReference:
        order.external_reference ?? null
    }
  );


  /*
   * ---------------------------------------------------------
   * 16. PAGAMENTO CONFIRMADO
   * ---------------------------------------------------------
   */

  if (
    order.status === 'processed' &&
    Number(order.total_paid_amount) >= 100
  ) {

    console.log(
      'Webhook MP: pagamento confirmado.'
    );

    try {

      await sendTicketEmail(order);

    } catch (error) {

      /*
       * O pagamento já foi confirmado.
       * Se o e-mail falhar, não transformamos o webhook
       * em erro de pagamento.
       */

      console.error(
        'Webhook MP: erro ao enviar ingresso por e-mail.',
        error
      );
    }

  } else {

    console.log(
      'Webhook MP: pedido recebido, mas ainda não está pago.',
      {
        status: order.status,
        totalPaid:
          order.total_paid_amount ?? null
      }
    );
  }


  /*
   * ---------------------------------------------------------
   * 17. FINALIZAR WEBHOOK
   * ---------------------------------------------------------
   */

  return new Response('OK', {
    status: 200
  });
};
