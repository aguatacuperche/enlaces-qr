// Creador de QR: cada cambio de opción actualiza la vista previa, las descargas y la comprobación de lectura.
// El dibujo lo hace siempre el servidor, así que lo que se ve es exactamente lo que se descarga.
(() => {
  const form = document.getElementById('creador');
  if (!form) return;
  const base = form.dataset.base;
  const img = document.getElementById('vista-previa');
  const lienzo = document.getElementById('lienzo');
  const lectura = document.getElementById('lectura');
  const textoLibre = document.getElementById('texto-libre');
  let turno = 0;

  const consulta = () => {
    const p = new URLSearchParams(new FormData(form));
    if (p.get('marco') !== 'libre') p.delete('texto');
    return p.toString();
  };

  const actualizar = async () => {
    const q = consulta();
    const datos = new FormData(form);
    img.src = `${base}.svg?${q}`;
    lienzo.classList.toggle('cuadros', datos.get('fondo') === 'transparente');
    textoLibre.hidden = datos.get('marco') !== 'libre';
    for (const a of document.querySelectorAll('[data-formato]')) a.href = `${base}.${a.dataset.formato}?${q}&descargar=1`;
    history.replaceState(null, '', `${base}?${q}`);

    const mio = ++turno;
    lectura.className = 'lectura';
    lectura.lastChild.textContent = 'Comprobando…';
    const r = await fetch(`${base}.json?${q}`).then(x => x.json()).catch(() => null);
    if (mio !== turno || !r) return;
    lectura.className = 'lectura ' + (r.seLee ? 'bien' : 'mal');
    lectura.lastChild.textContent = r.seLee ? 'Se lee bien' : 'Puede costar leerlo: prueba otras opciones';
  };

  let espera;
  form.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(actualizar, 150); });
  form.addEventListener('submit', e => { e.preventDefault(); actualizar(); });

  document.getElementById('copiar-imagen').addEventListener('click', async () => {
    try {
      const png = fetch(`${base}.png?${consulta()}`).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      avisar('Imagen copiada: pégala en un documento');
    } catch {
      avisar('Este navegador no deja copiar imágenes; usa Descargar PNG');
    }
  });

  actualizar();
})();
