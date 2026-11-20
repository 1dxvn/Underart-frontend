import { api, currentSession, saveSession } from '../api/client';
import { mountMercadoPagoCard } from '../api/mercado-pago';
import { mountCard } from '../api/stripe';
import type { Order, User } from '../api/types';
import { bindForm, dateTime, errorText, escapeHtml, feedback, heading, money, refreshView, value } from '../ui/html';

const paymentLabels = { PENDING: 'Pendiente de pago', PROCESSING: 'Pago en proceso', PAID: 'Pagado', FAILED: 'Pago rechazado', EXPIRED: 'Pago vencido' };
const shippingLabels = { PENDING: 'Pendiente de envío', SHIPPED: 'Enviado', DELIVERED: 'Entregado' };

export const paymentLabel = (order: Order) => order.checkout && order.paymentStatus === 'EXPIRED' ? 'Pago cancelado o vencido' : paymentLabels[order.paymentStatus];
export const shippingLabel = (order: Order) => shippingLabels[order.shippingStatus];

interface PaymentConfiguration {
  provider: 'simulated' | 'stripe' | 'mercadopago';
  publishableKey: string;
}

function checkout(order: Order, user: User, configuration: PaymentConfiguration | null) {
  if (order.winnerId !== user.id || !['PENDING', 'PROCESSING', 'FAILED'].includes(order.paymentStatus)) return '';
  if (!configuration) return '<p role="status">No se pudo cargar la configuración de pagos.</p>';
  const stripe = configuration.provider === 'stripe';
  const processing = order.paymentStatus === 'PROCESSING';
  if (!processing && Date.parse(order.paymentDueAt) <= Date.now()) return '<p>El plazo de pago terminó.</p>';
  const mercadoPago = configuration.provider === 'mercadopago';
  const title = mercadoPago ? 'Mercado Pago · Prueba' : stripe ? 'Pago con tarjeta' : 'Pago simulado';
  const shipping = `<label>Dirección de entrega<input name="shippingAddress" required maxlength="255" autocomplete="street-address" value="${escapeHtml(user.shippingAddress)}"></label>
    <label>Ciudad<input name="city" maxlength="255" autocomplete="address-level2" value="${escapeHtml(user.city)}"></label>`;
  if (mercadoPago && !processing) {
    if (order.snapshot.currency.toLowerCase() !== 'cop') {
      return `<section class="panel"><h2>${title}</h2><p>La pasarela de prueba está disponible para órdenes en pesos colombianos (COP).</p></section>`;
    }
    return `<section id="mercado-pago" class="panel form-stack">
      <h2>${title}</h2><p>Usa una tarjeta de prueba de Mercado Pago. No ingreses datos de una tarjeta real.</p>
      <form id="payment-shipping" class="form-stack">${shipping}</form>
      <div id="mercado-pago-card"></div>${feedback}</section>`;
  }
  return `<form id="payment" class="panel form-stack"><h2>${title}</h2>
    ${processing ? '<p>Consulta el estado del intento en curso desde esta orden.</p>' : `${shipping}
    ${stripe ? '<label>Tarjeta<div id="stripe-card" class="stripe-card"></div></label>'
      : '<p>El pago se realizará con el método de prueba de Underart.</p>'}`}
    <button class="button" type="submit">${processing ? 'Consultar pago' : stripe ? 'Pagar con tarjeta' : 'Confirmar pago simulado'}</button>${feedback}</form>`;
}

function fulfillment(order: Order, buyer: boolean) {
  if (order.paymentStatus !== 'PAID') return '';
  if (!buyer && order.shippingStatus === 'PENDING') return `<form id="ship" class="panel form-stack"><h2>Registrar envío</h2>
    <label>Transportadora<input name="carrier" maxlength="100" required></label>
    <label>Número de guía<input name="trackingNumber" maxlength="100" required></label>
    <button class="button" type="submit">Registrar envío</button>${feedback}</form>`;
  if (buyer && order.shippingStatus === 'SHIPPED') return `<form id="delivery" class="panel form-stack"><h2>Recepción de la obra</h2>
    <label class="check"><input type="checkbox" required> Confirmo que recibí la obra.</label>
    <button class="button" type="submit">Confirmar entrega</button>${feedback}</form>`;
  return '';
}

export async function orderDetails(root: HTMLElement, id: string) {
  const path = `/orders/${encodeURIComponent(id)}`;
  const [order, user] = await Promise.all([api<Order>(path), api<User>('/users/me')]);
  const buyer = order.winnerId === user.id;
  const configuration = buyer && ['PENDING', 'PROCESSING', 'FAILED'].includes(order.paymentStatus)
    ? await api<PaymentConfiguration>('/payments/config').catch(() => null) : null;
  const amount = (number: number) => money(number, order.snapshot.currency);
  root.innerHTML = `<div class="container page"><a class="text-link" href="#/account/${buyer ? 'purchases' : 'sales'}">Volver al panel</a>
    ${heading('Orden', escapeHtml(order.snapshot.title))}
    <div class="detail-grid"><section class="panel detail-copy"><h2>Resumen</h2>
      <dl class="data-list"><div><dt>Pago</dt><dd>${paymentLabel(order)}</dd></div><div><dt>Envío</dt><dd>${shippingLabel(order)}</dd></div>
      <div><dt>Subtotal</dt><dd>${amount(order.subtotal)}</dd></div><div><dt>Envío estimado</dt><dd>${amount(order.shippingCost)}</dd></div>
      <div><dt>Comisión</dt><dd>${amount(order.platformFee)}</dd></div><div><dt>Total</dt><dd><strong>${amount(order.totalPaid)}</strong></dd></div>
      ${order.paymentStatus !== 'PAID' ? `<div><dt>Plazo de pago</dt><dd>${dateTime(order.paymentDueAt)}</dd></div>` : ''}
      ${order.snapshot.shippingAddress ? `<div><dt>Destino</dt><dd>${escapeHtml([order.snapshot.recipient, order.snapshot.shippingAddress, order.snapshot.city].filter(Boolean).join(' · '))}</dd></div>` : ''}
      ${order.trackingNumber ? `<div><dt>Guía</dt><dd>${escapeHtml(order.carrier)} · ${escapeHtml(order.trackingNumber)}</dd></div>` : ''}
      ${order.shippedAt ? `<div><dt>Fecha de envío</dt><dd>${dateTime(order.shippedAt)}</dd></div>` : ''}
      ${order.deliveredAt ? `<div><dt>Fecha de entrega</dt><dd>${dateTime(order.deliveredAt)}</dd></div>` : ''}</dl>
      <a class="text-link" href="#/auctions/${escapeHtml(order.auctionId)}">Ver subasta</a>
    </section><div class="form-stack">${checkout(order, user, configuration)}
    ${buyer && order.checkout && ['PENDING', 'FAILED'].includes(order.paymentStatus) ? `<form id="cancel-checkout" class="form-stack">
      <button class="button secondary" type="submit">Cancelar y volver a la subasta</button>${feedback}</form>` : ''}
    ${fulfillment(order, buyer)}</div></div></div>`;
  bindForm(root, '#cancel-checkout', async () => {
    await api(`${path}/cancel-checkout`, { method: 'POST' });
    if (root.isConnected) location.hash = `/auctions/${order.auctionId}`;
  });
  let shippingAddressSaved = user.shippingAddress;
  let citySaved = user.city ?? '';
  async function saveShipping(data: FormData) {
    const shippingAddress = value(data, 'shippingAddress');
    const city = value(data, 'city');
    if (!shippingAddress) throw new Error('Ingresa la dirección de entrega.');
    if (shippingAddress === shippingAddressSaved && city === citySaved) return;
    const updated = await api<User>('/users/me', { method: 'PUT', body: { username: user.username, shippingAddress, city } });
    shippingAddressSaved = updated.shippingAddress;
    citySaved = updated.city ?? '';
    const active = currentSession();
    if (active?.user.id === updated.id) saveSession({ ...active, user: updated });
  }

  const mercadoCard = root.querySelector<HTMLElement>('#mercado-pago-card');
  const shippingForm = root.querySelector<HTMLFormElement>('#payment-shipping');
  const mercadoStatus = root.querySelector<HTMLElement>('#mercado-pago .feedback');
  if (mercadoCard && configuration && shippingForm && mercadoStatus) {
    shippingForm.addEventListener('submit', event => event.preventDefault());
    mercadoStatus.textContent = 'Cargando el formulario de prueba…';
    let submitting = false;
    void mountMercadoPagoCard(mercadoCard, configuration.publishableKey, order.totalPaid, {
      onReady: () => { mercadoStatus.textContent = ''; },
      onError: () => { mercadoStatus.textContent = 'Mercado Pago no pudo cargar el formulario de prueba.'; },
      async onSubmit(cardData) {
        if (submitting) throw new Error('Ya se está consultando el pago.');
        submitting = true;
        mercadoStatus.textContent = '';
        try {
          if (!shippingForm.reportValidity()) throw new Error('Completa la dirección de entrega.');
          await saveShipping(new FormData(shippingForm));
          try {
            await api<Order>(`${path}/pay`, { method: 'POST', body: {
              token: cardData.token,
              method: cardData.payment_method_id,
              issuer: cardData.issuer_id == null ? null : String(cardData.issuer_id),
              installments: Number(cardData.installments),
            } });
          } catch (error) {
            const current = await api<Order>(path).catch(() => null);
            if (mercadoCard.isConnected && current?.paymentStatus === 'PROCESSING') refreshView();
            throw error;
          }
          if (mercadoCard.isConnected) refreshView();
        } catch (error) {
          mercadoStatus.textContent = errorText(error);
          throw error;
        } finally {
          submitting = false;
        }
      },
    }).catch(error => { mercadoStatus.textContent = errorText(error); });
  }
  const cardContainer = root.querySelector<HTMLElement>('#stripe-card');
  const card = cardContainer && configuration ? mountCard(cardContainer, configuration.publishableKey) : null;
  void card?.catch(error => {
    const status = root.querySelector<HTMLElement>('#payment .feedback');
    if (status) status.textContent = error instanceof Error ? error.message : 'Stripe no está disponible.';
  });
  bindForm(root, '#payment', async data => {
    if (order.paymentStatus !== 'PROCESSING') {
      await saveShipping(data);
      let paymentToken: string;
      if (configuration?.provider === 'stripe') {
        if (!card) throw new Error('El formulario de tarjeta no está disponible.');
        paymentToken = await (await card)(user.email);
      } else if (configuration?.provider === 'simulated') {
        paymentToken = 'tok_visa';
      } else {
        throw new Error('El proveedor de pago no está disponible.');
      }
      const updated = await api<User>('/users/me/payment-method', { method: 'PUT', body: { paymentToken } });
      const active = currentSession();
      if (active?.user.id === updated.id) saveSession({ ...active, user: updated });
    }
    await api<Order>(`${path}/pay`, { method: 'POST' });
    if (root.isConnected) refreshView();
  });
  bindForm(root, '#ship', async data => {
    await api(`${path}/ship`, { method: 'POST', body: { carrier: value(data, 'carrier'), trackingNumber: value(data, 'trackingNumber') } });
    if (root.isConnected) refreshView();
  });
  bindForm(root, '#delivery', async () => {
    await api(`${path}/confirm-delivery`, { method: 'POST' });
    if (root.isConnected) refreshView();
  });
}
