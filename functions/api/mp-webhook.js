/**
 * Cloudflare Pages Function: POST /api/mp-webhook
 * Recibe notificaciones IPN / Webhook de Mercado Pago y responde HTTP 200
 * para confirmar recepción.
 */

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json().catch(() => ({}));
    console.log('[MP WEBHOOK]', JSON.stringify({
      type: payload.type || payload.topic || 'unknown',
      action: payload.action || '',
      data_id: payload.data ? payload.data.id : null,
    }));
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ status: 'ok', service: 'mp-webhook' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
