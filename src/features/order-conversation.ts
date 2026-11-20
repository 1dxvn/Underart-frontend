import { api, currentSession, saveSession } from '../api/client';
import type { Order, User } from '../api/types';
import { bindForm, dateTime, escapeHtml, feedback, refreshView, value } from '../ui/html';

interface Message {
  id: string;
  senderId: string;
  message: string;
  createdAt: string;
}

export function orderConversation(order: Order, user: User, openChat: boolean) {
  const buyer = order.winnerId === user.id;
  const open = ['COORDINATING', 'REPORTED'].includes(order.paymentStatus);
  const canStart = buyer && ['PENDING', 'FAILED'].includes(order.paymentStatus)
    && Date.parse(order.paymentDueAt) > Date.now();
  const canSend = order.paymentStatus !== 'EXPIRED'
    && (!order.checkout || open || ['PROCESSING', 'PAID'].includes(order.paymentStatus));
  const report = buyer && order.paymentStatus === 'COORDINATING';
  const review = !buyer && order.paymentStatus === 'REPORTED';

  return `<section class="panel form-stack">
    ${canStart ? `<form id="start-external" class="form-stack">
      <h2>Acordar el pago con el artista</h2>
      <p>Abre el chat del pedido para coordinar el pago externo. Antes de pagar, acuerda con el artista el importe final y la entrega.</p>
      <button class="button" type="submit">Chatear con el artista</button>${feedback}
    </form>` : ''}
    <details id="order-chat" ${open || openChat ? 'open' : ''}>
      <summary>${buyer ? 'Chat con el artista' : 'Chat con el comprador'}</summary>
      <p>Acuerden el pago y la entrega aquí. No compartas claves ni datos de tu tarjeta.</p>
      <div class="order-messages" role="log" aria-label="Mensajes del pedido"></div>
      <p class="chat-status" role="status"></p>
      ${canSend ? `<form id="send-message" class="form-stack">
        <label>Mensaje<textarea name="message" rows="2" required maxlength="2000"></textarea></label>
        <button class="button secondary" type="submit">Enviar mensaje</button>${feedback}
      </form>` : '<p>Conversación disponible para consulta.</p>'}
    </details>
    ${report ? `<form id="report-external" class="form-stack">
      <p>Reporta el pago cuando hayas enviado el dinero por el medio acordado. La reserva vence el ${dateTime(order.paymentDueAt)}.</p>
      <label>Dirección de entrega<input name="shippingAddress" required maxlength="255" autocomplete="street-address" value="${escapeHtml(user.shippingAddress)}"></label>
      <label>Ciudad<input name="city" maxlength="255" autocomplete="address-level2" value="${escapeHtml(user.city)}"></label>
      <button class="button" type="submit">Ya realicé el pago</button>${feedback}
    </form>` : ''}
    ${review ? `<form id="review-external" class="form-stack">
      <p>El comprador reportó un pago externo. Verifica la recepción en el medio acordado.</p>
      <label>Resultado<select name="received" required>
        <option value="">Selecciona un resultado</option><option value="yes">Recibí el pago</option>
        <option value="no">Todavía no recibí el pago</option>
      </select></label>
      <button class="button" type="submit">Guardar respuesta</button>${feedback}
    </form>` : ''}
  </section>`;
}

export function bindOrderConversation(root: HTMLElement, order: Order, user: User, path: string) {
  const chat = root.querySelector<HTMLDetailsElement>('#order-chat');
  const list = chat?.querySelector<HTMLElement>('.order-messages');
  const status = chat?.querySelector<HTMLElement>('.chat-status');
  if (!chat || !list || !status) return;
  let cursor = '';
  let loading = false;
  let loaded = false;

  async function load() {
    if (loading || !chat?.isConnected || !chat.open || document.hidden || !list || !status) return;
    loading = true;
    try {
      const messages = await api<Message[]>(`${path}/messages${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
      if (!chat.isConnected) return;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      for (const entry of messages) {
        const item = document.createElement('div');
        item.className = 'order-message';
        const author = entry.senderId === user.id ? 'Tú' : order.winnerId === user.id ? 'Artista' : 'Comprador';
        item.innerHTML = `<small>${author} · ${dateTime(entry.createdAt)}</small><p></p>`;
        item.querySelector('p')!.textContent = entry.message;
        list.append(item);
        cursor = entry.id;
      }
      if (nearBottom) list.scrollTop = list.scrollHeight;
      status.textContent = cursor ? '' : 'Todavía no hay mensajes.';
      if (loaded && ['COORDINATING', 'REPORTED'].includes(order.paymentStatus)) {
        const current = await api<Order>(path);
        if (chat.isConnected && current.paymentStatus !== order.paymentStatus) refreshView();
      }
      loaded = true;
    } catch {
      if (chat.isConnected) status.textContent = 'No se pudo actualizar el chat. Reintentando…';
    } finally {
      loading = false;
    }
  }

  chat.addEventListener('toggle', () => { if (chat.open) void load(); });
  const timer = window.setInterval(() => {
    if (!chat.isConnected) {
      clearInterval(timer);
      return;
    }
    void load();
  }, 6000);
  void load();

  bindForm(root, '#send-message', async (data, form) => {
    const message = value(data, 'message');
    if (!message) throw new Error('Escribe un mensaje.');
    await api(`${path}/messages`, { method: 'POST', body: { message } });
    form.reset();
    await load();
  });

  bindForm(root, '#start-external', async () => {
    await api(`${path}/external-payment/start`, { method: 'POST' });
    if (chat.isConnected) refreshView();
  });
  bindForm(root, '#report-external', async data => {
    const shippingAddress = value(data, 'shippingAddress');
    const city = value(data, 'city');
    if (!shippingAddress) throw new Error('Ingresa la dirección de entrega.');
    if (shippingAddress !== user.shippingAddress || city !== (user.city ?? '')) {
      const updated = await api<User>('/users/me', {
        method: 'PUT', body: { username: user.username, shippingAddress, city },
      });
      const active = currentSession();
      if (active?.user.id === updated.id) saveSession({ ...active, user: updated });
    }
    await api(`${path}/external-payment/report`, { method: 'POST' });
    if (chat.isConnected) refreshView();
  });
  bindForm(root, '#review-external', async data => {
    await api(`${path}/external-payment/review`, { method: 'POST', body: { received: value(data, 'received') === 'yes' } });
    if (chat.isConnected) refreshView();
  });
}
