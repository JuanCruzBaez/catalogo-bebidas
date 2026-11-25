/**
 * Cloudflare Pages Function: POST /api/mp-webhook
 * Recibe notificaciones Webhook de Mercado Pago, consulta el pago real en la API de MP
 * y, si está APROBADO, envía un email automático al comercio con todos los datos del cliente
 * (nombre, teléfono, dirección, modalidad, notas, productos y link directo a su WhatsApp).
 *
 * Variables de entorno en Cloudflare Pages (Settings -> Variables and secrets):
 * - MP_ACCESS_TOKEN (Secret): Access Token de Producción de Mercado Pago.
 * - RESEND_API_KEY (Secret): API Key gratuita de Resend (https://resend.com).
 * - NOTIFY_EMAIL (Opcional, Text): Email destino (default: bebidas.25demayo@hotmail.com).
 * - RESEND_FROM (Opcional, Text): Remitente (default: Bebidas 25 de Mayo <onboarding@resend.dev>).
 */

function formatAr(amount) {
  const num = Math.round(Number(amount) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanPhoneForWa(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) return '549' + digits.slice(2);
  if (digits.startsWith('0')) return '549' + digits.slice(1);
  return '549' + digits;
}

export async function onRequestPost(context) {
  try {
    const reqUrl = new URL(context.request.url);
    const payload = await context.request.json().catch(() => ({}));

    const topic = payload.type || payload.topic || reqUrl.searchParams.get('topic') || reqUrl.searchParams.get('type') || '';
    const paymentId =
      (payload.data && payload.data.id) ||
      reqUrl.searchParams.get('data.id') ||
      reqUrl.searchParams.get('id') ||
      '';

    // Solo procesamos eventos de pago con ID válido
    if (!paymentId || (topic && topic !== 'payment')) {
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const mpToken = (context.env && context.env.MP_ACCESS_TOKEN || '').trim();
    const resendKey = (context.env && context.env.RESEND_API_KEY || '').trim();
    const notifyEmail = (context.env && context.env.NOTIFY_EMAIL || 'bebidas.25demayo@hotmail.com').trim();
    const fromEmail = (context.env && context.env.RESEND_FROM || 'Bebidas 25 de Mayo <onboarding@resend.dev>').trim();

    if (!mpToken || !resendKey) {
      console.log('[MP WEBHOOK] Faltan credenciales (MP_ACCESS_TOKEN o RESEND_API_KEY)');
      return new Response(JSON.stringify({ received: true, email_sent: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Consultar el pago real en la API de Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });

    if (!mpRes.ok) {
      console.error('[MP WEBHOOK] Error consultando pago MP:', mpRes.status);
      return new Response(JSON.stringify({ received: true, mp_error: mpRes.status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payment = await mpRes.json();

    // Solo enviar email cuando el pago está efectivamente aprobado
    if (payment.status !== 'approved') {
      return new Response(JSON.stringify({ received: true, status: payment.status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const meta = payment.metadata || {};
    const orderRef = payment.external_reference || meta.order_ref || `MP-${payment.id}`;
    const customerName = meta.customer_name || (payment.payer && payment.payer.first_name) || 'Cliente Web';
    const customerPhone = meta.customer_phone || (payment.payer && payment.payer.phone && payment.payer.phone.number) || 'No informado';
    const deliveryType = meta.delivery_type || 'No especificado';
    const address = meta.address || 'No informada';
    const notes = meta.notes || '';
    const priceList = meta.price_list || 'MINORISTA';
    const totalPaid = payment.transaction_amount || 0;
    const payType = payment.payment_type_id === 'debit_card'
      ? 'Tarjeta de Débito'
      : (payment.payment_type_id === 'credit_card'
        ? `Tarjeta de Crédito (${payment.installments || 1} cuota/s)`
        : (payment.payment_method_id || 'Mercado Pago'));

    const items = (payment.additional_info && Array.isArray(payment.additional_info.items))
      ? payment.additional_info.items
      : [];

    const itemsRowsHtml = items.length
      ? items.map(it => {
          const qty = Number(it.quantity) || 1;
          const unit = Number(it.unit_price) || 0;
          return `
            <tr>
              <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">${qty}x ${escapeHtml(it.title)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;white-space:nowrap;">${formatAr(unit * qty)}</td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="2" style="padding:10px;color:#6b7280;">Ver detalle en operación #${escapeHtml(payment.id)} de Mercado Pago</td></tr>`;

    const waDigits = cleanPhoneForWa(customerPhone);
    const waLink = waDigits
      ? `https://wa.me/${waDigits}?text=${encodeURIComponent(`¡Hola ${customerName}! Recibimos tu pago en Bebidas 25 de Mayo (Orden ${orderRef}). Ya estamos preparando tu pedido 🙌`)}`
      : '';

    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#fdfbf7;border:2px solid #f59e0b;border-radius:16px;overflow:hidden;">
        <div style="background:#18181b;color:#ffffff;padding:20px 24px;border-bottom:3px solid #dc2626;">
          <div style="font-size:12px;letter-spacing:1.5px;color:#f59e0b;font-weight:800;text-transform:uppercase;">BEBIDAS 25 DE MAYO · TIENDA ONLINE</div>
          <h1 style="margin:6px 0 0;font-size:24px;color:#ffffff;">✅ Nuevo Pedido PAGADO</h1>
          <div style="margin-top:6px;font-size:14px;color:#fef08a;font-weight:700;">Orden ${escapeHtml(orderRef)} · Operación MP #${escapeHtml(payment.id)}</div>
        </div>

        <div style="padding:22px 24px;">
          <h2 style="margin:0 0 12px;font-size:15px;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">Datos del Cliente y Entrega</h2>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5dccf;border-radius:10px;margin-bottom:18px;">
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;width:130px;"><strong>Cliente:</strong></td><td style="padding:8px 12px;color:#111827;font-size:14px;font-weight:700;">${escapeHtml(customerName)}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;"><strong>Teléfono:</strong></td><td style="padding:8px 12px;color:#111827;font-size:14px;font-weight:700;">${escapeHtml(customerPhone)}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;"><strong>Modalidad:</strong></td><td style="padding:8px 12px;color:#111827;font-size:14px;">${escapeHtml(deliveryType)}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;"><strong>Dirección:</strong></td><td style="padding:8px 12px;color:#111827;font-size:14px;font-weight:700;">${escapeHtml(address)}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;"><strong>Medio de pago:</strong></td><td style="padding:8px 12px;color:#111827;font-size:14px;">${escapeHtml(payType)} · Lista ${escapeHtml(priceList)}</td></tr>
            ${notes ? `<tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;"><strong>Notas:</strong></td><td style="padding:8px 12px;color:#b45309;font-size:14px;font-weight:600;">${escapeHtml(notes)}</td></tr>` : ''}
          </table>

          <h2 style="margin:0 0 10px;font-size:15px;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">Detalle del Pedido</h2>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5dccf;border-radius:10px;margin-bottom:18px;">
            ${itemsRowsHtml}
            <tr style="background:#18181b;">
              <td style="padding:12px;color:#ffffff;font-weight:800;font-size:15px;">TOTAL ABONADO</td>
              <td style="padding:12px;color:#fef08a;font-weight:900;font-size:20px;text-align:right;">${formatAr(totalPaid)}</td>
            </tr>
          </table>

          ${waLink ? `
            <div style="text-align:center;margin-top:20px;">
              <a href="${waLink}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:12px;">
                💬 Escribirle al cliente por WhatsApp
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // 2. Enviar Email automático vía Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: `✅ Pedido PAGADO ${orderRef} — ${customerName} (${formatAr(totalPaid)})`,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const errTxt = await emailRes.text().catch(() => '');
      console.error('[MP WEBHOOK] Error enviando email Resend:', emailRes.status, errTxt);
    }

    return new Response(JSON.stringify({ received: true, email_sent: emailRes.ok }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[MP WEBHOOK] Excepción:', e);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ status: 'ok', service: 'mp-webhook-email' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
