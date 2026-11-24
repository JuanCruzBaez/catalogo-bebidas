/**
 * Cloudflare Pages Function: POST /api/crear-pago
 * Crea una preferencia de Mercado Pago Checkout Pro validando los precios reales
 * desde el catálogo estático (/api/public/products.json y /api/public/combos.json).
 *
 * Variables de entorno en Cloudflare Pages (Settings -> Variables and secrets):
 * - MP_ACCESS_TOKEN (Obligatoria, Secret): Access Token de Producción de Mercado Pago.
 * - MP_DEBIT_SURCHARGE_PCT (Opcional, Text): % de recargo para Tarjeta de Débito (default: 2).
 * - MP_CREDIT_SURCHARGE_PCT (Opcional, Text): % de recargo para Tarjeta de Crédito (default: 7).
 */

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchStaticJson(context, origin, path) {
  if (context.env && context.env.ASSETS) {
    const assetRes = await context.env.ASSETS.fetch(new Request(`${origin}${path}`));
    if (assetRes.ok) return await assetRes.json();
  }
  const res = await fetch(`${origin}${path}`);
  if (!res.ok) throw new Error(`No se pudo leer ${path}`);
  return await res.json();
}

export async function onRequestPost(context) {
  try {
    const token = (context.env && context.env.MP_ACCESS_TOKEN || '').trim();
    if (!token) {
      return jsonResponse({
        error: 'El pago online con Mercado Pago todavía no está activado en el servidor (falta configurar MP_ACCESS_TOKEN en Cloudflare Pages).',
        code: 'MP_NOT_CONFIGURED',
      }, 503);
    }

    const body = await context.request.json();
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const customer = body.customer || {};

    if (rawItems.length === 0) {
      return jsonResponse({ error: 'El carrito está vacío.' }, 400);
    }

    const url = new URL(context.request.url);
    const origin = url.origin;

    // 1. Cargar catálogo real para evitar manipulación de precios desde el cliente
    const [products, combos] = await Promise.all([
      fetchStaticJson(context, origin, '/api/public/products.json'),
      fetchStaticJson(context, origin, '/api/public/combos.json'),
    ]);

    const prodMap = new Map(products.map(p => [String(p.id), p]));
    const comboMap = new Map(combos.map(c => [String(c.id), c]));

    // 2. Calcular subtotal minorista para determinar si califica a lista mayorista (>=$100.000)
    const WHOLESALE_THRESHOLD = 100000;
    let retailSubtotal = 0;
    const resolved = [];

    for (const reqItem of rawItems) {
      const qty = Math.max(1, Math.min(99, parseInt(reqItem.qty, 10) || 1));
      const type = reqItem.type === 'combo' ? 'combo' : 'product';

      if (type === 'combo') {
        const combo = comboMap.get(String(reqItem.id));
        if (!combo) continue;
        const price = Number(combo.price) || 0;
        if (price <= 0) continue;
        retailSubtotal += price * qty;
        resolved.push({
          id: `combo-${combo.id}`,
          title: combo.name,
          description: combo.description || 'Combo promocional Bebidas 25 de Mayo',
          picture_url: combo.image_path ? `${origin}/${combo.image_path.replace(/^\/+/, '')}` : `${origin}/static/images/logo.png`,
          quantity: qty,
          unit_price_min: price,
          unit_price_may: price,
          is_combo: true,
        });
      } else {
        const prod = prodMap.get(String(reqItem.id));
        if (!prod || prod.is_out_of_stock) continue;
        const pMin = Number(prod.price_minorista) || 0;
        const pMay = Number(prod.price_mayorista) || pMin;
        if (pMin <= 0) continue;
        retailSubtotal += pMin * qty;
        resolved.push({
          id: `prod-${prod.id}`,
          title: prod.presentation ? `${prod.name} (${prod.presentation})` : prod.name,
          description: prod.category_name || 'Bebidas 25 de Mayo',
          picture_url: prod.image_path ? `${origin}/${prod.image_path.replace(/^\/+/, '')}` : `${origin}/static/images/logo.png`,
          quantity: qty,
          unit_price_min: pMin,
          unit_price_may: pMay,
          is_combo: false,
        });
      }
    }

    if (resolved.length === 0) {
      return jsonResponse({ error: 'No se encontraron productos válidos en el pedido.' }, 400);
    }

    const qualifiesWholesale = retailSubtotal >= WHOLESALE_THRESHOLD;
    const rawMethod = String(body.payment_method || customer.payment || '').toLowerCase();
    const isDebit = rawMethod.includes('debito') || rawMethod.includes('débito') || rawMethod === 'debit';
    const isCredit = rawMethod.includes('credito') || rawMethod.includes('crédito') || rawMethod === 'credit';

    const debitPct = Math.max(0, Math.min(30, parseFloat(context.env.MP_DEBIT_SURCHARGE_PCT ?? '2') || 0));
    const creditPct = Math.max(0, Math.min(30, parseFloat(context.env.MP_CREDIT_SURCHARGE_PCT ?? '7') || 0));

    let surchargePct = 0;
    let surchargeLabel = '';
    let excludedPaymentTypes = [{ id: 'ticket' }, { id: 'atm' }];

    if (isDebit) {
      surchargePct = debitPct;
      surchargeLabel = `Recargo Tarjeta de Débito (${surchargePct}%)`;
      // Bloquear tarjeta de crédito cuando eligió tarifa de débito (+2%)
      excludedPaymentTypes = [{ id: 'credit_card' }, { id: 'ticket' }, { id: 'atm' }];
    } else if (isCredit) {
      surchargePct = creditPct;
      surchargeLabel = `Recargo Tarjeta de Crédito (${surchargePct}%)`;
      excludedPaymentTypes = [{ id: 'ticket' }, { id: 'atm' }];
    }

    let subtotalEffective = 0;
    const mpItems = resolved.map(it => {
      const unitPrice = (!it.is_combo && qualifiesWholesale) ? it.unit_price_may : it.unit_price_min;
      const roundedPrice = Math.round(unitPrice * 100) / 100;
      subtotalEffective += roundedPrice * it.quantity;
      return {
        id: it.id,
        title: it.title.slice(0, 250),
        description: it.description.slice(0, 250),
        picture_url: it.picture_url,
        category_id: 'food',
        quantity: it.quantity,
        currency_id: 'ARS',
        unit_price: roundedPrice,
      };
    });

    let totalFinal = subtotalEffective;
    if (surchargePct > 0) {
      const surchargeAmount = Math.round(subtotalEffective * (surchargePct / 100));
      if (surchargeAmount > 0) {
        totalFinal += surchargeAmount;
        mpItems.push({
          id: isDebit ? 'recargo-debito' : 'recargo-credito',
          title: surchargeLabel,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: surchargeAmount,
        });
      }
    }

    const orderRef = `B25-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const preferencePayload = {
      items: mpItems,
      payment_methods: {
        excluded_payment_types: excludedPaymentTypes,
      },
      payer: {
        name: String(customer.name || 'Cliente Web').slice(0, 120),
        phone: {
          number: String(customer.phone || '').replace(/[^\d+]/g, '').slice(0, 25),
        },
      },
      external_reference: orderRef,
      statement_descriptor: 'BEBIDAS 25 DE MAYO',
      back_urls: {
        success: `${origin}/?pago=aprobado&orden=${encodeURIComponent(orderRef)}`,
        pending: `${origin}/?pago=pendiente&orden=${encodeURIComponent(orderRef)}`,
        failure: `${origin}/?pago=rechazado&orden=${encodeURIComponent(orderRef)}`,
      },
      auto_return: 'approved',
      notification_url: `${origin}/api/mp-webhook`,
      metadata: {
        order_ref: orderRef,
        customer_name: String(customer.name || ''),
        customer_phone: String(customer.phone || ''),
        delivery_type: String(customer.deliveryType || ''),
        address: String(customer.address || ''),
        notes: String(customer.notes || ''),
        price_list: qualifiesWholesale ? 'MAYORISTA' : 'MINORISTA',
      },
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderRef,
      },
      body: JSON.stringify(preferencePayload),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok || !mpData.init_point) {
      console.error('Mercado Pago API error:', mpRes.status, mpData);
      return jsonResponse({
        error: 'No se pudo generar el link de pago en Mercado Pago. Intentá nuevamente o finalizá por WhatsApp.',
        detail: mpData && mpData.message ? mpData.message : undefined,
      }, 502);
    }

    return jsonResponse({
      ok: true,
      order_ref: orderRef,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      total: totalFinal,
      surcharge_pct: surchargePct,
      qualifies_wholesale: qualifiesWholesale,
    });
  } catch (err) {
    console.error('Error en /api/crear-pago:', err);
    return jsonResponse({ error: 'Error interno al iniciar el pago online.' }, 500);
  }
}
