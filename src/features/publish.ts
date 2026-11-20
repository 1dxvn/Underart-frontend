import { api, currentSession } from '../api/client';
import type { Artwork, ArtworkDetail, Auction, Media, Page } from '../api/types';
import { configurePriceInput, formatCopInput, parsePrice } from '../ui/prices';
import { bindForm, errorText, escapeHtml, feedback, heading, mediaUrl, money, value } from '../ui/html';

const fileTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];

export async function publish(root: HTMLElement, artworkId?: string) {
  const artwork = artworkId ? await api<ArtworkDetail>(`/artworks/${encodeURIComponent(artworkId)}`) : null;
  if (artwork && artwork.artwork.artistId !== currentSession()?.user.id) throw new Error('Solo puedes añadir multimedia a tus propias obras.');
  root.innerHTML = `<div class="container page narrow">${heading('Para artistas', artwork ? 'Multimedia de la obra' : 'Publicar una obra')}
    ${artwork ? `<p class="lede">${escapeHtml(artwork.artwork.title)}</p>
    <form class="panel form-stack" id="media">
      <label>Imágenes y videos<input type="file" name="files" multiple accept="${fileTypes.join(',')}" required></label>
      <p class="muted">Hasta 15 archivos por obra. Imágenes de hasta 10 MB y videos de hasta 50 MB.</p>
      <button class="button" type="submit">Subir archivos</button>${feedback}
      <ul id="uploads" class="plain-list"></ul></form>
    <p id="image-required" class="muted">Sube al menos una imagen para poder crear la subasta.</p>
    <div class="actions spaced"><a id="create-auction" class="button" href="#/publish/auction?artworkId=${escapeHtml(artwork.artwork.id)}">Crear subasta</a>
      <a class="text-link" href="#/artworks/${escapeHtml(artwork.artwork.id)}">Ver ficha pública</a></div>`
    : `<form class="panel form-stack" id="artwork">
      <label>Título<input name="title" maxlength="255" required></label>
      <label>Descripción<textarea name="description" maxlength="2000" rows="4"></textarea></label>
      <label>Técnica<input name="technique" maxlength="255"></label>
      <div class="form-row"><label>Dimensiones<input name="dimensions" maxlength="255" placeholder="30 × 40 cm"></label>
      <label>Peso en kg<input name="weightKg" type="number" min="0.001" step="any"></label></div>
      <button class="button" type="submit">Guardar y añadir multimedia</button>${feedback}</form>`}
    </div>`;
  bindForm(root, '#artwork', async data => {
    const weight = value(data, 'weightKg');
    const created = await api<Artwork>('/artworks', { method: 'POST', body: {
      textValuation: false, title: value(data, 'title'), description: value(data, 'description') || null,
      technique: value(data, 'technique') || null, dimensions: value(data, 'dimensions') || null,
      weightKg: weight ? Number(weight) : null,
    } });
    if (root.isConnected) location.hash = `/publish/media/${created.id}`;
  });
  if (!artwork) return;
  const uploads = root.querySelector<HTMLElement>('#uploads')!;
  const renderFiles = () => {
    uploads.innerHTML = artwork.media.map((item, index) =>
      `<li>${item.kind === 'IMAGE' ? 'Imagen' : 'Video'} ${index + 1}${item.cover ? ' · Portada' : ''}</li>`).join('');
    const hasImage = artwork.media.some(item => item.kind === 'IMAGE');
    root.querySelector<HTMLElement>('#create-auction')!.hidden = !hasImage;
    root.querySelector<HTMLElement>('#image-required')!.hidden = hasImage;
  };
  renderFiles();
  const uploadedFiles = new Set<string>();
  bindForm(root, '#media', async (data, form) => {
    const entries = data.getAll('files').filter((file): file is File => file instanceof File && file.size > 0);
    const key = (file: File) => JSON.stringify([file.name, file.size, file.lastModified]);
    const files = [...new Map(entries.map(file => [key(file), file])).values()].filter(file => !uploadedFiles.has(key(file)));
    if (files.length + artwork.media.length > 15) throw new Error('La obra puede tener un máximo de 15 archivos.');
    for (const file of files) {
      const limit = file.type.startsWith('image/') ? 10 : 50;
      if (!fileTypes.includes(file.type) || file.size > limit * 1024 * 1024) throw new Error(`Tipo o tamaño no permitido para ${file.name}.`);
    }
    const status = form.querySelector<HTMLElement>('.feedback')!;
    for (const file of files) {
      status.textContent = `Subiendo ${file.name}…`;
      const body = new FormData();
      body.set('file', file);
      const media = await api<Media>(`/artworks/${encodeURIComponent(artwork.artwork.id)}/media`, { method: 'POST', body });
      artwork.media.push(media);
      uploadedFiles.add(key(file));
      renderFiles();
    }
    form.reset();
    status.textContent = 'Multimedia actualizada.';
  });
}

export async function publishAuction(root: HTMLElement, selected: string | null) {
  const results = await api<Page<Artwork>>('/users/me/artworks?size=100');
  const artworks = results.items;
  if (selected && !artworks.some(artwork => artwork.id === selected)) {
    const detail = await api<ArtworkDetail>(`/artworks/${encodeURIComponent(selected)}`);
    if (detail.artwork.artistId === currentSession()?.user.id) artworks.unshift(detail.artwork);
  }
  root.innerHTML = `<div class="container page narrow">${heading('Para artistas', 'Crear subasta')}
    ${!artworks.length ? '<div class="panel"><p>Publica una obra antes de crear una subasta.</p><a class="button" href="#/publish">Publicar obra</a></div>' : `
    <form class="panel form-stack" id="auction">
      <label>Obra<select name="artworkId" required>${artworks.map(artwork => `<option value="${escapeHtml(artwork.id)}" ${artwork.id === selected ? 'selected' : ''}>${escapeHtml(artwork.title)}</option>`).join('')}</select></label>
      <label>Modalidad<select name="type"><option value="SIMPLE">Solo pujas</option><option value="IMMEDIATE">Pujas y compra inmediata</option>
      <option value="DUTCH">Holandesa, precio descendente</option><option value="SEALED">Sobre cerrado</option></select></label>
      <label>Moneda<select name="currency"><option value="USD">Dólares estadounidenses (USD)</option>
      <option value="COP">Pesos colombianos (COP)</option><option value="EUR">Euros (EUR)</option></select></label>
      <div class="panel form-stack">
        <label>Imagen que analizará Groq<select name="image" required disabled></select></label>
        <img id="auction-image-preview" alt="Imagen seleccionada de la obra" width="220" hidden>
        <p id="auction-image-status" class="feedback" role="status"></p>
        <a id="upload-auction-image" class="text-link" hidden>Subir imagen de la obra</a>
        <button class="button secondary" type="button" id="image-advice" disabled>Analizar imagen con IA</button>
        <p id="image-advice-result" class="feedback" role="status"></p>
        <button class="button secondary" type="button" id="use-image-price" hidden>Usar como precio base</button>
      </div>
      <p id="currency-help" class="muted" hidden>Usa múltiplos de 1.000 COP. Por ejemplo, 25.000 equivale a veinticinco mil pesos.</p>
      <p id="format-help" class="muted"></p>
      <div class="form-row"><label><span id="base-label">Precio base</span><input name="basePrice" type="number" min="0.01" max="999999999999.99" step="0.01" required></label>
      <label id="immediate" hidden>Precio de compra inmediata<input name="immediatePurchasePrice" type="number" min="0.01" max="999999999999.99" step="0.01" disabled></label>
      <label id="floor" hidden>Precio mínimo<input name="floorPrice" type="number" min="0.01" max="999999999999.99" step="0.01" disabled></label></div>
      <div class="form-row"><label>Inicio opcional<input name="startDate" type="datetime-local"></label>
      <label>Cierre<input name="endDate" type="datetime-local" required></label></div>
      <p class="muted">Las fechas se interpretan en la zona horaria de tu dispositivo.</p>
      <button class="button" type="submit" disabled>Publicar subasta</button>${feedback}
    </form>`}</div>`;
  const currency = root.querySelector<HTMLSelectElement>('[name="currency"]');
  function updateCurrency() {
    if (!currency) return;
    root.querySelector<HTMLElement>('#currency-help')!.hidden = currency.value !== 'COP';
    root.querySelectorAll<HTMLInputElement>('[name="basePrice"], [name="immediatePurchasePrice"], [name="floorPrice"]')
      .forEach(input => configurePriceInput(input, currency.value));
  }
  currency?.addEventListener('change', updateCurrency);
  updateCurrency();
  const type = root.querySelector<HTMLSelectElement>('[name="type"]');
  function updateFormat() {
    if (!type) return;
    const dutch = type.value === 'DUTCH';
    for (const [selector, visible] of [['#immediate', type.value === 'IMMEDIATE'], ['#floor', dutch]] as const) {
      const field = root.querySelector<HTMLElement>(selector)!;
      const input = field.querySelector('input')!;
      field.hidden = input.disabled = !visible;
      input.required = visible;
    }
    root.querySelector<HTMLElement>('#base-label')!.textContent = dutch ? 'Precio inicial' : 'Precio base';
    root.querySelector<HTMLElement>('#format-help')!.textContent = dutch
      ? 'El precio desciende hasta el mínimo durante la subasta. La venta se confirma cuando se aprueba el pago.'
      : type.value === 'SEALED' ? 'Cada cuenta envía una sola puja privada. Se revelan al cierre.' : '';
  }
  type?.addEventListener('change', updateFormat);
  updateFormat();
  const form = root.querySelector<HTMLFormElement>('#auction');
  if (!form || !currency) return;
  const auctionArtwork = form.querySelector<HTMLSelectElement>('[name="artworkId"]')!;
  const image = form.querySelector<HTMLSelectElement>('[name="image"]')!;
  const preview = form.querySelector<HTMLImageElement>('#auction-image-preview')!;
  const imageStatus = form.querySelector<HTMLElement>('#auction-image-status')!;
  const uploadLink = form.querySelector<HTMLAnchorElement>('#upload-auction-image')!;
  const analyze = form.querySelector<HTMLButtonElement>('#image-advice')!;
  const result = form.querySelector<HTMLElement>('#image-advice-result')!;
  const usePrice = form.querySelector<HTMLButtonElement>('#use-image-price')!;
  const publishButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  let selectionVersion = 0;
  let analysisVersion = 0;
  let suggestedPrice: number | undefined;
  let uploadedImages: Media[] = [];

  function updatePreview() {
    const url = mediaUrl(uploadedImages.find(item => item.id === image.value)?.url ?? null);
    preview.hidden = !url;
    if (url) preview.src = url;
    else preview.removeAttribute('src');
  }

  function clearAnalysis() {
    ++analysisVersion;
    suggestedPrice = undefined;
    result.textContent = '';
    usePrice.hidden = true;
    analyze.disabled = image.disabled || !image.value;
  }

  async function loadImages() {
    const selection = ++selectionVersion;
    const id = auctionArtwork.value;
    uploadLink.href = `#/publish/media/${encodeURIComponent(id)}`;
    uploadLink.hidden = true;
    image.disabled = publishButton.disabled = true;
    image.replaceChildren();
    uploadedImages = [];
    updatePreview();
    clearAnalysis();
    imageStatus.textContent = 'Buscando imágenes de la obra…';
    try {
      const detail = await api<ArtworkDetail>(`/artworks/${encodeURIComponent(id)}`);
      if (selection !== selectionVersion) return;
      const images = uploadedImages = detail.media.filter(item => item.kind === 'IMAGE');
      images.forEach((item, index) => image.add(new Option(`Imagen ${index + 1}${item.cover ? ' · Portada' : ''}`, item.id)));
      image.disabled = publishButton.disabled = !images.length;
      uploadLink.hidden = images.length > 0;
      imageStatus.textContent = images.length ? '' : 'Sube al menos una imagen antes de publicar la subasta.';
      updatePreview();
      clearAnalysis();
    } catch (error) {
      if (selection !== selectionVersion) return;
      imageStatus.textContent = errorText(error);
      uploadLink.hidden = false;
    }
  }

  auctionArtwork.addEventListener('change', () => void loadImages());
  image.addEventListener('change', () => {
    updatePreview();
    clearAnalysis();
  });
  currency.addEventListener('change', clearAnalysis);
  void loadImages();

  analyze.addEventListener('click', async () => {
    if (image.disabled || !image.value || root.dataset.busy) return;
    const analysis = ++analysisVersion;
    analyze.disabled = true;
    usePrice.hidden = true;
    result.textContent = 'Analizando la imagen…';
    try {
      const advice = await api<{ description: string; suggestedPrice: number; shippingEstimate: number; currency: string }>(
        '/ai/image-advice', { method: 'POST', body: { artworkId: auctionArtwork.value, mediaId: image.value, currency: currency.value } });
      if (analysis !== analysisVersion || !root.isConnected) return;
      suggestedPrice = advice.suggestedPrice;
      result.textContent = `${advice.description} Valor orientativo ${money(advice.suggestedPrice, advice.currency)}. Envío estimado por peso ${money(advice.shippingEstimate, advice.currency)}.`;
      usePrice.hidden = false;
    } catch (error) {
      if (analysis === analysisVersion) result.textContent = errorText(error);
    } finally {
      if (analysis === analysisVersion) analyze.disabled = false;
    }
  });

  usePrice.addEventListener('click', () => {
    if (suggestedPrice == null) return;
    const base = form.querySelector<HTMLInputElement>('[name="basePrice"]')!;
    base.value = String(suggestedPrice);
    if (currency.value === 'COP') formatCopInput(base);
  });

  bindForm(root, '#auction', async data => {
    if (image.disabled || !image.value) throw new Error('La obra necesita al menos una imagen.');
    const auctionCurrency = value(data, 'currency');
    const basePrice = parsePrice(value(data, 'basePrice'), auctionCurrency, 'Precio base o inicial');
    const immediate = value(data, 'immediatePurchasePrice');
    const floor = value(data, 'floorPrice');
    const floorPrice = floor ? parsePrice(floor, auctionCurrency, 'Precio mínimo') : null;
    if (floorPrice != null && floorPrice >= basePrice) throw new Error('El precio mínimo debe ser inferior al inicial.');
    const immediatePurchasePrice = immediate ? parsePrice(immediate, auctionCurrency, 'Precio de compra inmediata') : null;
    const start = value(data, 'startDate');
    const end = new Date(value(data, 'endDate'));
    if (immediatePurchasePrice != null && immediatePurchasePrice <= basePrice) throw new Error('El precio de compra inmediata debe superar el precio base.');
    if (end.getTime() <= Math.max(Date.now(), start ? Date.parse(start) : 0)) throw new Error('El cierre debe ser futuro y posterior al inicio.');
    const auction = await api<Auction>('/auctions', { method: 'POST', body: {
      artworkId: value(data, 'artworkId'), type: value(data, 'type'), currency: value(data, 'currency'), basePrice, immediatePurchasePrice, floorPrice,
      startDate: start ? new Date(start).toISOString() : null, endDate: end.toISOString(),
    } });
    if (root.isConnected) location.hash = `/auctions/${auction.id}`;
  });
}
