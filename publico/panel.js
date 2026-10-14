// Panel: copiar con un clic, confirmar antes de borrar, filtros que se aplican solos,
// comprobar el nombre mientras se escribe y la ayuda del gráfico de visitas.
(() => {
  const aviso = document.getElementById('aviso');
  let reloj;
  window.avisar = texto => {
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.classList.add('ver');
    clearTimeout(reloj);
    reloj = setTimeout(() => aviso.classList.remove('ver'), 2000);
  };

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copiar]');
    if (!b) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(b.dataset.copiar);
      avisar('Copiado: ' + b.dataset.copiar.replace(/^https?:\/\//, ''));
    } catch {
      avisar('No se ha podido copiar');
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-confirmar]');
    if (f && !confirm(f.dataset.confirmar)) e.preventDefault();
  });

  for (const s of document.querySelectorAll('select[data-enviar]')) s.addEventListener('change', () => s.form.submit());

  // Nombre del enlace nuevo: ancho a la medida y aviso al momento si no vale o ya existe.
  const nombre = document.getElementById('nombre');
  const ayuda = document.getElementById('nombre-ayuda');
  if (nombre && ayuda) {
    const textoAyuda = ayuda.textContent;
    const ajustar = () => { nombre.style.width = Math.max(5, nombre.value.length + 1) + 'ch'; };
    let espera;
    nombre.addEventListener('input', () => {
      ajustar();
      clearTimeout(espera);
      espera = setTimeout(async () => {
        const r = await fetch('/panel/nombre?valor=' + encodeURIComponent(nombre.value)).then(x => x.json()).catch(() => null);
        if (!r) return;
        nombre.closest('.nombre-campo').classList.toggle('mal', !!r.problema);
        ayuda.classList.toggle('mal', !!r.problema);
        ayuda.textContent = r.problema || textoAyuda;
      }, 250);
    });
    ajustar();
  }

  // Ayuda al pasar por las barras del gráfico de visitas.
  for (const g of document.querySelectorAll('[data-grafico]')) {
    const ayudaG = g.querySelector('.ayuda-grafico'), svg = g.querySelector('svg');
    g.addEventListener('mousemove', e => {
      const barra = e.target.closest('g[data-ayuda]');
      if (!barra) { ayudaG.style.opacity = 0; return; }
      const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      ayudaG.textContent = barra.dataset.ayuda;
      ayudaG.style.left = barra.dataset.x * k + 'px';
      ayudaG.style.top = (barra.dataset.y * k - 6) + 'px';
      ayudaG.style.opacity = 1;
    });
    g.addEventListener('mouseleave', () => { ayudaG.style.opacity = 0; });
  }
})();
