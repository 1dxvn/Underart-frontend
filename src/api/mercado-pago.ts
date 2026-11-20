interface CardData {
  token: string;
  payment_method_id: string;
  issuer_id?: string | number;
  installments: number;
}

interface MercadoPagoSdk {
  bricks(): {
    create(type: 'cardPayment', container: string, settings: {
      initialization: { amount: number };
      callbacks: {
        onReady: () => void;
        onError: () => void;
        onSubmit: (data: CardData) => Promise<void>;
      };
    }): Promise<{ unmount(): void }>;
  };
}

const sdkWindow = window as Window & {
  MercadoPago?: new (key: string, options: { locale: string }) => MercadoPagoSdk;
};
let sdkLoad: Promise<void> | undefined;

function loadSdk() {
  if (sdkWindow.MercadoPago) return Promise.resolve();
  return sdkLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('No se pudo cargar Mercado Pago. Recarga la página para reintentar.'));
    };
    document.head.append(script);
  }).catch(error => {
    sdkLoad = undefined;
    throw error;
  });
}

export async function mountMercadoPagoCard(container: HTMLElement, publicKey: string, amount: number,
    callbacks: { onReady: () => void; onError: () => void; onSubmit: (data: CardData) => Promise<void> }) {
  await loadSdk();
  if (!container.isConnected) return;
  if (!publicKey || !sdkWindow.MercadoPago) throw new Error('Mercado Pago de prueba no está disponible.');
  const sdk = new sdkWindow.MercadoPago(publicKey, { locale: 'es-CO' });
  const card = await sdk.bricks().create('cardPayment', container.id, { initialization: { amount }, callbacks });
  const observer = new MutationObserver(cleanup);
  function cleanup() {
    if (container.isConnected) return;
    observer.disconnect();
    card.unmount();
  }
  observer.observe(document.body, { childList: true, subtree: true });
  cleanup();
}
