// Creador de QR: cada cambio de opción actualiza la vista previa, las descargas y la comprobación de lectura.
// Lo dibuja siempre el servidor, así que lo que se ve es exactamente lo que se descarga.
// Tres pestañas: el código suelto, el cartel y la hoja de pegatinas (estas dos, en PDF).
(() => {
  const form = document.getElementById('creador');
  if (!form) return;
  const base = form.dataset.base;            // /panel/enlaces/<id>/qr
  const raiz = base.replace(/\/qr$/, '');    // /panel/enlaces/<id>
  const img = document.getElementById('vista-previa');
  const lienzo = document.getElementById('lienzo');
  const lectura = document.getElementById('lectura');
  const textoLibre = document.getElementById('texto-libre');
  const campoModo = document.getElementById('modo');
  const medida = document.getElementById('medida');
  const hoja = document.getElementById('hoja');
  let turno = 0;

  const consulta = () => {
    const p = new URLSearchParams(new FormData(form));
    if (p.get('marco') !== 'libre') p.delete('texto');
    if (p.get('hoja') !== 'medida') for (const k of [...p.keys()]) if (k.startsWith('m_')) p.delete(k);
    return p.toString();
  };

  const vistaPdf = (modo, q) => {
    const marco = document.querySelector(`iframe[data-pdf="${modo}"]`);
    // Sin la columna de miniaturas y con la página a lo ancho, en el visor del navegador.
    if (marco) marco.src = `${raiz}/${modo}.pdf?${q}#navpanes=0&view=FitH`;
  };

  const actualizar = async () => {
    const q = consulta();
    const datos = new FormData(form);
    const modo = datos.get('modo');
    textoLibre.hidden = datos.get('marco') !== 'libre';
    if (medida) medida.hidden = datos.get('hoja') !== 'medida';
    for (const a of document.querySelectorAll('[data-formato]')) a.href = `${raiz}/${a.dataset.formato}?${q}&descargar=1`;
    history.replaceState(null, '', `${base}?${q}`);
    if (modo === 'codigo') {
      img.src = `${base}.svg?${q}`;
      lienzo.classList.toggle('cuadros', datos.get('fondo') === 'transparente');
    } else {
      vistaPdf(modo, q);
    }

    const mio = ++turno;
    lectura.className = 'lectura';
    lectura.lastChild.textContent = 'Comprobando…';
    const r = await fetch(`${base}.json?${q}`).then(x => x.json()).catch(() => null);
    if (mio !== turno || !r) return;
    lectura.className = 'lectura ' + (r.seLee ? 'bien' : 'mal');
    lectura.lastChild.textContent = r.seLee ? 'Se lee bien' : 'Puede costar leerlo: prueba otras opciones';
  };

  // Los PDF tardan algo más en hacerse: se espera a que el profesor deje de escribir.
  let espera;
  form.addEventListener('input', e => {
    clearTimeout(espera);
    const lento = campoModo.value !== 'codigo' && e.target.matches('input[type=text], input:not([type]), input[type=number], input[inputmode]');
    espera = setTimeout(actualizar, lento ? 600 : 150);
  });
  form.addEventListener('submit', e => { e.preventDefault(); actualizar(); });

  for (const b of document.querySelectorAll('[data-modo]')) {
    b.addEventListener('click', () => {
      campoModo.value = b.dataset.modo;
      for (const x of document.querySelectorAll('[data-modo]')) x.setAttribute('aria-selected', x === b);
      for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== b.dataset.modo;
      actualizar();
    });
  }
  hoja?.addEventListener('change', () => { if (medida) medida.hidden = hoja.value !== 'medida'; });

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
