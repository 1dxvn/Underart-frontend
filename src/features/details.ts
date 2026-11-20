import { api, currentSession } from '../api/client';
import type { ArtworkDetail, Auction, AuctionDetail, Bid, Order, Page } from '../api/types';
import { bindForm, cover, dateTime, empty, escapeHtml, feedback, heading, mediaUrl, money, pageLinks, pageNumber, refreshView, value } from '../ui/html';
import { configurePriceInput, parsePrice } from '../ui/prices';
import { loginLink } from './auth';
import { auctionLabel, formatLabel } from './catalog';

function gallery(detail: ArtworkDetail) {
  const { artwork, media } = detail;
  return `<div class="gallery">${media.length ? media.map(item => item.kind === 'VIDEO'
    ? `<video controls preload="metadata" aria-label="${escapeHtml(artwork.title)}" src="${mediaUrl(item.url)}"></video>`
    : cover(item.url, artwork.title)).join('') : cover(artwork.coverUrl, artwork.title)}</div>`;
}

function favoriteForm(detail: ArtworkDetail) {
  const label = detail.favorited ? 'Quitar de favoritos' : 'Guardar en favoritos';
  return currentSession()
    ? `<form id="favorite"><button class="button secondary" type="submit">${label}</button>${feedback}</form>`
    : `<a class="button secondary" href="${loginLink()}">Inicia sesión para guardar</a>`;
}

function bindFavorite(root: HTMLElement, detail: ArtworkDetail) {
  bindForm(root, '#favorite', async () => {
    await api(`/artworks/${encodeURIComponent(detail.artwork.id)}/favorite`, { method: detail.favorited ? 'DELETE' : 'POST' });
    if (root.isConnected) refreshView();
  });
}

async function getArtwork(id: string) {
  const path = `/artworks/${encodeURIComponent(id)}`;
  if (!currentSession()) return api<ArtworkDetail>(path, { anonymous: true });
  try {
    return await api<ArtworkDetail>(path);
  } catch (error) {
    if (currentSession()) throw error;
    return api<ArtworkDetail>(path, { anonymous: true });
  }
}

export async function artworkDetails(root: HTMLElement, id: string, params: URLSearchParams) {
  const path = `/artworks/${encodeURIComponent(id)}`;
  const auctionsRequest = api<Page<Auction>>(`/auctions?artworkId=${encodeURIComponent(id)}&page=${pageNumber(params)}&size=10`, { anonymous: true })
    .catch(() => null);
  const detail = await getArtwork(id);
  const artwork = detail.artwork;
  const artistRequest = api<{ username: string }>(`/users/${encodeURIComponent(artwork.artistId)}`, { anonymous: true }).catch(() => null);
  root.innerHTML = `<div class="container page">
    <a class="text-link" href="#/artworks">Volver a obras</a>
    ${heading('Obra', escapeHtml(artwork.title))}
    <div class="detail-grid">${gallery(detail)}<div class="panel detail-copy">
      <div id="artwork-artist"></div>
      <h2>Sobre la obra</h2><p>${escapeHtml(artwork.description || 'Sin descripción.')}</p>
      <dl class="data-list">${artwork.technique ? `<div><dt>Técnica</dt><dd>${escapeHtml(artwork.technique)}</dd></div>` : ''}
      ${artwork.dimensions ? `<div><dt>Dimensiones</dt><dd>${escapeHtml(artwork.dimensions)}</dd></div>` : ''}
      ${artwork.weightKg ? `<div><dt>Peso</dt><dd>${artwork.weightKg} kg</dd></div>` : ''}</dl>
      <div class="actions">${favoriteForm(detail)}<span class="muted">${detail.favoritesCount} favoritos</span></div>
      <h3>Subastas de esta obra</h3>
      <div id="artwork-auctions" aria-live="polite"><p class="muted">Cargando subastas…</p></div>
    </div></div></div>`;
  bindFavorite(root, detail);
  await Promise.all([
    artistRequest.then(artist => {
      if (!artist || !root.isConnected) return;
      root.querySelector('#artwork-artist')!.innerHTML = `<p><a class="text-link" href="#/users/${escapeHtml(artwork.artistId)}">Ver perfil de ${escapeHtml(artist.username)}</a></p>`;
    }),
    auctionsRequest.then(auctions => {
      if (!root.isConnected) return;
      root.querySelector('#artwork-auctions')!.innerHTML = auctions
        ? (auctions.items.length
          ? `<ul class="plain-list">${auctions.items.map(auction => `<li><a class="text-link" href="#/auctions/${escapeHtml(auction.id)}">${auctionLabel(auction)} · ${dateTime(auction.endDate)}</a></li>`).join('')}</ul>`
          : '<p class="muted">Esta obra aún no tiene subastas.</p>')
          + pageLinks(path, params, auctions.page, auctions.totalPages)
        : empty('Las subastas de esta obra no están disponibles en este momento.');
    }),
  ]);
}

function auctionActions(detail: AuctionDetail, own: boolean) {
  const auction = detail.auction;
  if (auctionLabel(auction) !== 'En curso') return '';
  const highest = detail.highestBid;
  if (own) {
    if (!highest || auction.type === 'SEALED' || auction.type === 'DUTCH') {
      return '<p class="muted">Esta subasta pertenece a una obra tuya.</p>';
    }
    return `<form id="accept-bid" class="form-stack">
      <p>Aceptar la puja líder cierra la subasta y genera un pedido para ese comprador.</p>
      <label class="check"><input type="checkbox" required> Confirmo la adjudicación anticipada.</label>
      <button class="button" type="submit">Aceptar puja · ${money(highest.amount, auction.currency ?? undefined)}</button>
      ${feedback}</form>`;
  }
  if (!currentSession()) return `<a class="button" href="${loginLink()}">Inicia sesión para participar</a>`;
  if (auction.type === 'DUTCH') return `<form id="buy" class="form-stack">
    <p>El precio vigente se muestra en el siguiente paso. La venta se confirma al completar el pago.</p>
    <label class="check"><input type="checkbox" required> Confirmo que quiero continuar al pago.</label>
    <button class="button" type="submit">Aceptar precio vigente</button>${feedback}</form>`;
  const sealed = auction.type === 'SEALED';
  return `<form id="bid" class="form-stack">${sealed ? '<p>Solo puedes enviar una puja. Los importes se revelan al cierre.</p>' : ''}
    <label>${sealed ? 'Tu puja privada' : 'Tu puja'}<input name="amount" type="number" inputmode="decimal" min="${detail.minimumNextBid}" max="999999999999.99" step="0.01" required value="${detail.minimumNextBid}"></label>
    <button class="button" type="submit">${sealed ? 'Enviar puja privada' : 'Confirmar puja'}</button>${feedback}</form>
    ${auction.immediatePurchasePrice == null ? '' : `<form id="buy" class="form-stack">
    <label class="check"><input type="checkbox" required> Confirmo que quiero continuar al pago.</label>
    <button class="button secondary" type="submit">Ir al pago · ${money(auction.immediatePurchasePrice, auction.currency ?? undefined)}</button>${feedback}</form>`}`;
}

function countdown(endDate: string, element: HTMLElement, completeLabel: string) {
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((Date.parse(endDate) - Date.now()) / 1000));
    const units = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60];
    element.textContent = seconds === 0 ? completeLabel : `${units[0]} d · ${units[1]} h · ${units[2]} min · ${seconds % 60} s`;
    return seconds;
  };
  if (!tick()) return;
  const timer = window.setInterval(() => {
    if (!element.isConnected) window.clearInterval(timer);
    else if (!tick()) {
      window.clearInterval(timer);
      refreshView();
    }
  }, 1000);
}

const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 20l4-.8L21 6l-3-3L5 16z"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3m4 0-1 14H6L5 6m5 4v6m4-6v6"/></svg>';

function auctionManagement(auction: Auction) {
  return `<div class="auction-management" role="group" aria-label="Gestionar subasta">
    <button class="button secondary auction-icon" type="button" data-auction-dialog="edit" aria-label="Editar subasta" title="Editar subasta">${editIcon}</button>
    <button class="button secondary auction-icon" type="button" data-auction-dialog="delete" aria-label="Eliminar subasta" title="Eliminar subasta">${trashIcon}</button>
  </div>
  <dialog class="panel auction-dialog" id="auction-edit-dialog" aria-labelledby="auction-edit-title">
    <form id="edit-auction" class="form-stack">
      <h2 id="auction-edit-title">Editar subasta</h2>
      <label>${auction.type === 'DUTCH' ? 'Precio inicial' : 'Precio base'}<input name="basePrice" type="number" min="0.01" step="0.01" value="${auction.basePrice}" required></label>
      ${auction.type === 'IMMEDIATE' || auction.immediatePurchasePrice != null ? `<label>Precio de compra inmediata<input name="immediatePurchasePrice" type="number" min="0.01" step="0.01" value="${auction.immediatePurchasePrice ?? ''}" required></label>` : ''}
      ${auction.type === 'DUTCH' ? `<label>Precio mínimo<input name="floorPrice" type="number" min="0.01" step="0.01" value="${auction.floorPrice ?? ''}" required></label>` : ''}
      <label>Cierre<input name="endDate" type="datetime-local" required></label>
      <div class="actions"><button class="button" type="submit">Guardar cambios</button><button class="button secondary" type="button" data-close-dialog>Volver</button></div>${feedback}
    </form>
  </dialog>
  <dialog class="panel auction-dialog" id="auction-delete-dialog" aria-labelledby="auction-delete-title">
    <form id="delete-auction" class="form-stack">
      <h2 id="auction-delete-title">Eliminar subasta</h2>
      <p>La subasta se retirará del catálogo y quedará como cancelada en tu historial.</p>
      <div class="actions"><button class="button" type="submit">Eliminar subasta</button><button class="button secondary" type="button" data-close-dialog>Volver</button></div>${feedback}
    </form>
  </dialog>`;
}

function bindAuctionManagement(root: HTMLElement, auction: Auction, path: string) {
  const form = root.querySelector<HTMLFormElement>('#edit-auction');
  if (!form) return;
  const currency = auction.currency ?? '';
  const storedEnd = new Date(auction.endDate);
  const localEnd = new Date(storedEnd.getTime() - storedEnd.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  form.querySelector<HTMLInputElement>('[name="endDate"]')!.value = localEnd;
  form.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(input => configurePriceInput(input, currency));
  root.querySelectorAll<HTMLButtonElement>('[data-auction-dialog]').forEach(button => {
    button.addEventListener('click', () => root.querySelector<HTMLDialogElement>(`#auction-${button.dataset.auctionDialog}-dialog`)?.showModal());
  });
  root.querySelectorAll<HTMLButtonElement>('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  bindForm(root, '#edit-auction', async data => {
    const immediate = value(data, 'immediatePurchasePrice');
    const floor = value(data, 'floorPrice');
    const end = value(data, 'endDate');
    await api(path, { method: 'PUT', body: {
      basePrice: parsePrice(value(data, 'basePrice'), currency, 'Precio base'),
      immediatePurchasePrice: immediate ? parsePrice(immediate, currency, 'Precio de compra inmediata') : null,
      floorPrice: floor ? parsePrice(floor, currency, 'Precio mínimo') : null,
      endDate: end === localEnd ? auction.endDate : new Date(end).toISOString(),
    } });
    if (root.isConnected) refreshView();
  });
  bindForm(root, '#delete-auction', async () => {
    await api(path, { method: 'DELETE' });
    if (root.isConnected) location.hash = '/account/auctions';
  });
}

export async function auctionDetails(root: HTMLElement, id: string, params: URLSearchParams) {
  const path = `/auctions/${encodeURIComponent(id)}`;
  const detail = await api<AuctionDetail>(path, { anonymous: true });
  const { auction } = detail;
  const sealed = auction.type === 'SEALED' && auction.status === 'ACTIVE';
  const bidsRequest = !sealed && currentSession()
    ? api<Page<Bid>>(`${path}/bids?page=${pageNumber(params)}&size=10`).catch(() => null)
    : null;
  const artwork = await getArtwork(auction.artworkId);
  const own = currentSession()?.user.id === artwork.artwork.artistId;
  const status = auctionLabel(auction);
  const scheduled = status === 'Programada';
  const dutch = auction.type === 'DUTCH';
  const currency = auction.currency ?? undefined;
  root.innerHTML = `<div class="container page"><a class="text-link" href="#/auctions">Volver a subastas</a>
    ${heading(formatLabel(auction), escapeHtml(auction.artworkTitle))}
    <div class="detail-grid"><div>${gallery(artwork)}<div class="actions spaced">
    <a class="text-link" href="#/artworks/${escapeHtml(auction.artworkId)}">Ficha de la obra</a>${favoriteForm(artwork)}</div></div>
    <section class="panel detail-copy">
    <div class="auction-card-header"><p class="eyebrow">${status}</p>
    ${own && auction.status === 'ACTIVE' && Date.parse(auction.endDate) > Date.now() && !auction.bidCount
      ? auctionManagement(auction) : ''}
    </div>
    <p class="muted">${dutch ? 'Precio vigente' : sealed || !auction.bidCount ? 'Precio base' : 'Puja actual'}</p>
    <p class="price" id="current-price">${money(auction.currentPrice, currency)}</p>
    <dl class="data-list">${detail.minimumNextBid == null ? '' : `<div><dt>${sealed ? 'Importe mínimo' : 'Próxima puja mínima'}</dt><dd>${money(detail.minimumNextBid, currency)}</dd></div>`}
    ${auction.floorPrice == null ? '' : `<div><dt>Precio mínimo</dt><dd>${money(auction.floorPrice, currency)}</dd></div>`}
    <div><dt>Pujas registradas</dt><dd>${auction.bidCount}</dd></div><div><dt>Inicio</dt><dd>${dateTime(auction.startDate)}</dd></div>
    <div><dt>Cierre</dt><dd>${dateTime(auction.endDate)}</dd></div></dl>
    ${status === 'En curso' || scheduled ? `<p class="countdown">${scheduled ? 'Empieza en' : 'Termina en'} · <span id="countdown"></span></p>` : ''}
    ${auctionActions(detail, own)}
    </section></div>
    <section class="history"><h2>Historial de pujas</h2><div id="bids"></div></section></div>`;
  const timer = root.querySelector<HTMLElement>('#countdown');
  if (timer) countdown(scheduled ? auction.startDate : auction.endDate, timer, scheduled ? 'Inicio' : 'Tiempo cumplido');
  if (dutch && status === 'En curso') {
    const price = root.querySelector<HTMLElement>('#current-price')!;
    const interval = window.setInterval(async () => {
      if (!root.isConnected) return window.clearInterval(interval);
      const latest = await api<AuctionDetail>(path, { anonymous: true }).catch(() => null);
      if (!latest || !root.isConnected) return;
      if (latest.auction.status !== 'ACTIVE') {
        window.clearInterval(interval);
        refreshView();
        return;
      }
      price.textContent = money(latest.auction.currentPrice, currency);
    }, 3000);
  }
  bindFavorite(root, artwork);
  bindAuctionManagement(root, auction, path);
  bindForm(root, '#accept-bid', async () => {
    const order = await api<Order>(`${path}/accept-bid`, { method: 'POST', body: { bidId: detail.highestBid?.id } });
    if (root.isConnected) location.hash = `/orders/${order.id}`;
  });
  const bidInput = root.querySelector<HTMLInputElement>('#bid [name="amount"]');
  if (bidInput && currency === 'COP') {
    bidInput.value = String(detail.minimumNextBid ?? '');
    configurePriceInput(bidInput, currency);
  }
  bindForm(root, '#bid', async (data, form) => {
    const amount = parsePrice(value(data, 'amount'), currency ?? '', 'Importe de la puja');
    if (sealed) {
      await api(`${path}/bids`, { method: 'POST', body: { amount } });
      if (root.isConnected) location.hash = '/account/bids';
      return;
    }
    try {
      await api(`${path}/bids`, { method: 'POST', body: { amount } });
    } catch (error) {
      const latest = await api<AuctionDetail>(path, { anonymous: true }).catch(() => null);
      const amount = form.elements.namedItem('amount') as HTMLInputElement;
      if (latest?.minimumNextBid != null) amount.min = String(latest.minimumNextBid);
      throw error;
    }
    if (root.isConnected) refreshView();
  });
  bindForm(root, '#buy', async () => {
    const order = await api<Order>(`${path}/buy-now`, { method: 'POST' });
    if (root.isConnected) location.hash = `/orders/${order.id}`;
  });
  const bids = root.querySelector<HTMLElement>('#bids')!;
  if (sealed) {
    bids.innerHTML = empty('Los importes y participantes se revelan al cierre.');
    return;
  }
  if (!currentSession()) {
    bids.innerHTML = `<a class="text-link" href="${loginLink()}">Inicia sesión para ver el historial completo</a>`;
    return;
  }
  const response = await bidsRequest;
  bids.innerHTML = response ? (response.items.length ? `<ul class="rows">${response.items.map(bid => `<li><strong>${money(bid.amount, currency)}${bid.buyerId === currentSession()?.user.id ? ' · Tu puja' : ''}</strong><span>${dateTime(bid.bidTime)}</span></li>`).join('')}</ul>` : empty('Todavía no hay pujas.'))
    + pageLinks(path, params, response.page, response.totalPages) : empty('El historial no está disponible en este momento.');
}
