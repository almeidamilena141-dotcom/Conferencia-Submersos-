import {
  onRequestPost as criarPagamento
} from "./functions/api/criar-pagamento.js";

import {
  onRequestPost as webhookMercadoPago
} from "./functions/webhook-mercadopago.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Criar pagamento
    if (
      url.pathname === "/api/criar-pagamento" &&
      request.method === "POST"
    ) {
      return criarPagamento({
        request,
        env
      });
    }

    // Webhook do Mercado Pago
    if (
      url.pathname === "/webhook-mercadopago" &&
      request.method === "POST"
    ) {
      return webhookMercadoPago({
        request,
        env
      });
    }

    // Todo o restante continua sendo o site normal
    return env.ASSETS.fetch(request);
  }
};
