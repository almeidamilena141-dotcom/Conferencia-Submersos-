CONFIGURAÇÃO DO SITE SUBMERSOS + MERCADO PAGO

1) No Netlify, crie estas variáveis de ambiente (Production + Functions):
   MERCADOPAGO_ACCESS_TOKEN = Access Token de produção do Mercado Pago
   MERCADOPAGO_WEBHOOK_SECRET = chave secreta gerada em Webhooks > Configurar notificações
   RESEND_API_KEY = opcional nesta primeira fase, para envio automático de e-mail
   EMAIL_FROM = opcional nesta primeira fase, ex.: SUBMERSOS <ingressos@seu-dominio.com>

2) Configure no Mercado Pago o Webhook de produção para:
   https://conferenciasubmersos.netlify.app/api/webhook-mercadopago
   Evento: Order (Mercado Pago)

3) O formulário envia nome, e-mail, WhatsApp e tamanho da camiseta ao backend.
4) O backend cria uma Order de R$ 100,00 com expiração de P1D (24 horas) e retorna checkout_url.
5) O comprador é redirecionado ao Checkout Pro do Mercado Pago.
6) Quando a Order for processada, o webhook consulta a Order novamente e, se houver RESEND configurado, envia o ingresso por e-mail.

IMPORTANTE: nunca coloque MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET ou RESEND_API_KEY no index.html.

OBSERVAÇÃO: a prevenção de check-in duplicado ainda precisa de uma camada persistente de armazenamento. Nesta versão, o QR identifica o ingresso, mas o registro de uso único será implementado na próxima etapa com armazenamento seguro.
