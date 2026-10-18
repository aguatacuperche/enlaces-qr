/**
 * Informe mensual por correo: a cada profesor que tenga enlaces que no abren (o avisos sin dar por buenos), la lista
 * de los suyos, con el motivo y el enlace a su ficha. Sale el primer lunes de cada mes a las 8:00 (hora del centro);
 * si ese día el servidor estaba parado, en cuanto vuelva, dentro del mismo mes. Nunca dos veces el mismo mes, y solo
 * si desde su último informe ha aparecido algún problema nuevo: lo que sigue igual se ve en el panel, sin insistir.
 */
import fs from 'node:fs';
import resvg from '@resvg/resvg-js';
import type { Bd } from './db.ts';
import { esAviso } from './comprobacion.ts';
import type { Cartero, Correo } from './correo.ts';
import { hoy } from './fechas.ts';
import { cargarMarca, ficheroDeMarca, type Color, type Papel } from './marca.ts';

const ZONA = process.env.ZONA_HORARIA || 'Europe/Madrid';
const HORA = 8;

export type EnlaceDelInforme = {
  id: number; tipo: 'enlace' | 'pagina'; nombre: string; titulo: string; visitas: number;
  problema: string | null; problema_detalle: string | null;
  elementos: { titulo: string; problema_detalle: string; nuevo?: boolean }[];
  /** Ha aparecido después del último informe que recibió su dueño. */
  nuevo?: boolean;
};
/** `yaRecibio`: si ha recibido algún informe antes (entonces se marca lo nuevo). */
export type Destinatario = { id: number; correo: string; nombre: string; enlaces: EnlaceDelInforme[]; yaRecibio?: boolean };
export type Contexto = { dominio: string; urlPublica: string; pie: string; colores: Record<Papel, Color>; conLogo: boolean; fondo?: string };

// ---------------------------------------------------------------- Cuándo toca

/** «2026-11» y si ya ha llegado el momento de enviar el de ese mes. */
export function momento(ahora = new Date(), zona = ZONA): { mes: string; toca: boolean } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora).map(x => [x.type, x.value]));
  const ano = Number(p.year), mes = Number(p.month), dia = Number(p.day), hora = Number(p.hour);
  const diaSemanaDel1 = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();  // 0 domingo … 6 sábado
  const primerLunes = 1 + (8 - diaSemanaDel1) % 7;
  return { mes: `${ano}-${p.month}`, toca: dia > primerLunes || (dia === primerLunes && hora >= HORA) };
}

/** Día del próximo envío, para enseñarlo en el panel. */
export function proximoEnvio(ahora = new Date(), zona = ZONA): Date {
  for (let i = 0; i < 70; i++) {
    const d = new Date(ahora.getTime() + i * 864e5);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: zona, day: 'numeric', weekday: 'short' }).formatToParts(d);
    const dia = Number(local.find(x => x.type === 'day')!.value), semana = local.find(x => x.type === 'weekday')!.value;
    if (semana === 'Mon' && dia <= 7 && (i > 0 || !momento(ahora, zona).toca)) return d;
  }
  return ahora;
}

// ---------------------------------------------------------------- Quién recibe qué

export async function destinatarios(bd: Bd): Promise<Destinatario[]> {
  // «Nuevo»: el problema empezó después del último informe que recibió el dueño (o nunca recibió ninguno).
  const { rows } = await bd.query<EnlaceDelInforme & { usuario_id: number; correo: string; dueno: string; ya_recibio: boolean }>(
    `select e.id, e.tipo, e.nombre, e.titulo, e.problema, e.problema_detalle, e.usuario_id, u.correo, u.nombre as dueno,
            e.visitas_anteriores + coalesce((select sum(total) from visitas v where v.enlace_id = e.id), 0)::int as visitas,
            coalesce((select json_agg(json_build_object('titulo', x.titulo, 'problema_detalle', x.problema_detalle,
                        'nuevo', i.ultimo is null or x.problema_desde > i.ultimo) order by x.posicion)
                      from elementos x where x.pagina_id = e.id and x.problema is not null), '[]') as elementos,
            (e.problema is not null and not e.aviso_ignorado and (i.ultimo is null or e.problema_desde > i.ultimo))
              or exists (select 1 from elementos x where x.pagina_id = e.id and x.problema is not null
                           and (i.ultimo is null or x.problema_desde > i.ultimo)) as nuevo,
            i.ultimo is not null as ya_recibio
     from enlaces e join usuarios u on u.id = e.usuario_id
     left join lateral (select max(enviado) as ultimo from informes where usuario_id = u.id) i on true
     where e.activo and (e.caduca is null or e.caduca >= $1::date)
       and ((e.problema is not null and not e.aviso_ignorado)
            or exists (select 1 from elementos x where x.pagina_id = e.id and x.problema is not null))
     order by u.id, e.titulo`, [hoy()]);
  const porUsuario = new Map<number, Destinatario>();
  for (const r of rows) {
    const d = porUsuario.get(r.usuario_id) ?? { id: r.usuario_id, correo: r.correo, nombre: r.dueno, enlaces: [], yaRecibio: r.ya_recibio };
    d.enlaces.push({
      id: r.id, tipo: r.tipo, nombre: r.nombre, titulo: r.titulo, visitas: r.visitas, problema: r.problema,
      problema_detalle: r.problema_detalle, elementos: r.elementos, nuevo: r.nuevo,
    });
    porUsuario.set(r.usuario_id, d);
  }
  return [...porUsuario.values()];
}

// ---------------------------------------------------------------- El correo

const esc = (s: string) => s.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);
const numero = new Intl.NumberFormat('es-ES');

/** Mezcla un color con blanco (los programas de correo no entienden color-mix). */
function claro(hex: string, proporcion: number): string {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return '#' + c.map(v => Math.round(v * proporcion + 255 * (1 - proporcion)).toString(16).padStart(2, '0')).join('');
}

/** Mezcla un color con negro, para textos en colores claros como el amarillo. */
function oscuro(hex: string, proporcion: number): string {
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * proporcion).toString(16).padStart(2, '0')).join('');
}

/** ¿Está roto? Una página cuenta como rota si alguno de sus enlaces no abre. */
const roto = (e: EnlaceDelInforme) => (e.problema && !esAviso(e.problema)) || e.elementos.length > 0;

const TIPO = "font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;";

export function componerInforme(d: Destinatario, cx: Contexto, prueba = false): Correo {
  const c = cx.colores;
  // Lo nuevo, primero; y solo se marca como nuevo si antes ya recibió algún informe (la primera vez, todo lo es).
  const marcar = !!d.yaRecibio;
  const orden = (a: EnlaceDelInforme, b: EnlaceDelInforme) => Number(!!b.nuevo) - Number(!!a.nuevo);
  const rotos = d.enlaces.filter(roto).sort(orden), revisar = d.enlaces.filter(e => !roto(e)).sort(orden);
  const nuevos = d.enlaces.filter(e => e.nuevo).length;
  const n = d.enlaces.length;
  const nombrePila = d.nombre.split(/\s+/)[0] || d.nombre;
  const ficha = (e: EnlaceDelInforme) => `${cx.urlPublica}/panel/enlaces/${e.id}`;
  const corta = (e: EnlaceDelInforme) => `${cx.dominio}/${e.nombre}`;
  const asunto = (prueba ? '[Prueba] ' : '') + (n === 1 ? `Un enlace tuyo de ${cx.dominio} necesita revisión` : `${n} enlaces tuyos de ${cx.dominio} necesitan revisión`);
  const titular = n === 1 ? 'Tienes un enlace que conviene revisar' : `Tienes ${n} enlaces que conviene revisar`;
  const intro = `Una vez al mes te avisamos de los enlaces tuyos de ${cx.dominio} que no abren, o que no abren como se espera. Arreglarlos es rápido, y lo que ya está impreso sigue valiendo.`
    + (marcar && nuevos ? ` Desde el último aviso ${nuevos === 1 ? 'ha aparecido uno nuevo' : `han aparecido ${nuevos} nuevos`}: van marcados.` : '');
  const etiquetaNuevo = `<span style="display:inline-block;vertical-align:2px;margin-left:6px;padding:1px 8px;border-radius:999px;background:${c.principal.valor};color:#ffffff;font-size:11px;font-weight:900;letter-spacing:.04em;">NUEVO</span>`;

  const motivo = (e: EnlaceDelInforme) => {
    if (e.tipo === 'pagina' && e.elementos.length) {
      const lista = e.elementos.map(x => `<li style="margin:2px 0;"><b>${esc(x.titulo)}</b>: ${esc(x.problema_detalle)}</li>`).join('');
      return `<b style="color:${c.tercero.valor};">${e.elementos.length === 1 ? 'Uno de sus enlaces no abre' : `${e.elementos.length} de sus enlaces no abren`}:</b><ul style="margin:6px 0 0;padding-left:18px;">${lista}</ul>`;
    }
    const aviso = esAviso(e.problema);
    return `<b style="color:${aviso ? oscuro(c.acento.valor, 0.5) : c.tercero.valor};">${aviso ? 'Revisa' : 'No abre'}:</b> ${esc(e.problema_detalle ?? '')}`
      + (aviso ? `<br><span style="color:#6a6f7d;">Si es a propósito (por ejemplo, solo para cuentas del centro), pulsa «Dar por bueno» y no volverá a salir.</span>` : '');
  };

  const tarjeta = (e: EnlaceDelInforme) => {
    const borde = roto(e) ? c.tercero.valor : c.acento.valor;
    return `
    <tr><td style="padding:6px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e1e4ec;border-left:5px solid ${borde};border-radius:12px;">
        <tr><td style="padding:14px 16px;${TIPO}">
          <div style="font-size:16px;font-weight:800;color:${c.oscuro.valor};line-height:1.3;">${esc(e.titulo)}${e.tipo === 'pagina' ? ' <span style="font-weight:700;font-size:12px;color:#6a6f7d;">(página)</span>' : ''}${marcar && e.nuevo ? etiquetaNuevo : ''}</div>
          <div style="font-size:13px;color:#6a6f7d;margin-top:3px;">${esc(corta(e))} · ${numero.format(e.visitas)} ${e.visitas === 1 ? 'visita' : 'visitas'}</div>
          <div style="font-size:14px;line-height:1.5;color:#474c59;margin-top:9px;">${motivo(e)}</div>
          <div style="margin-top:12px;"><a href="${ficha(e)}" style="display:inline-block;background:${claro(c.principal.valor, 0.12)};color:${c.principal.valor};font-weight:800;font-size:14px;padding:9px 16px;border-radius:9px;text-decoration:none;">Arreglarlo</a></div>
        </td></tr>
      </table>
    </td></tr>`;
  };

  const seccion = (titulo: string, color: string, lista: EnlaceDelInforme[]) => lista.length ? `
    <tr><td style="padding:18px 28px 4px;${TIPO}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:10px;height:10px;background:${color};border-radius:5px;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding-left:8px;font-size:13px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#474c59;">${titulo} (${lista.length})</td>
      </tr></table>
    </td></tr>${lista.map(tarjeta).join('')}` : '';

  const paso = (n: number, color: string, titulo: string, texto: string) => `
        <tr><td valign="top" style="padding:6px 0;width:30px;"><div style="width:22px;height:22px;border-radius:7px;background:${color};color:#ffffff;font-weight:900;font-size:13px;line-height:22px;text-align:center;${TIPO}">${n}</div></td>
            <td style="padding:6px 0;font-size:14px;line-height:1.45;color:#474c59;${TIPO}"><b style="color:${c.oscuro.valor};">${titulo}</b> ${texto}</td></tr>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(asunto)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;">
<tr><td align="center" style="padding:24px 10px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td style="padding:0;font-size:0;line-height:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${(['principal', 'segundo', 'tercero', 'acento'] as const).map(p => `<td style="height:6px;background:${c[p].valor};width:25%;">&nbsp;</td>`).join('')}
      </tr></table>
    </td></tr>
    <tr><td ${cx.fondo ? `background="${cx.fondo}" ` : ''}style="padding:22px 28px 4px;background-color:#ffffff;${cx.fondo ? `background-image:url('${cx.fondo}');background-repeat:no-repeat;background-position:right 14px top 10px;background-size:210px auto;` : ''}${TIPO}">
      <!-- Al fondo, muy tenue, un eslabón partido con tirita: el motivo del correo, con una sonrisa. -->
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${cx.conLogo ? '<td style="padding-right:10px;"><img src="cid:isotipo" width="34" height="34" alt="" style="display:block;border:0;"></td>' : ''}
        <td style="font-size:17px;font-weight:900;color:${c.oscuro.valor};${TIPO}">${esc(cx.dominio)}</td>
      </tr></table>
      <p style="margin:18px 0 6px;font-size:16px;color:#474c59;">Hola, ${esc(nombrePila)}:</p>
      <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:900;color:${c.oscuro.valor};${TIPO}">${titular}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#474c59;">${esc(intro)}</p>
    </td></tr>
    ${seccion('No abren', c.tercero.valor, rotos)}
    ${seccion('Para revisar', c.acento.valor, revisar)}
    <tr><td style="padding:22px 28px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;border-radius:12px;">
        <tr><td style="padding:14px 16px 8px;${TIPO}">
          <div style="font-size:15px;font-weight:900;color:${c.oscuro.valor};margin-bottom:4px;">Cómo se arregla</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${paso(1, c.principal.valor, 'Cambia el destino', 'por uno que funcione. Los carteles y QR que ya estén impresos llevarán al nuevo.')}
            ${paso(2, c.segundo.valor, '¿Ya no se usa?', 'Quita «Activo» para pausarlo: quien lo abra verá un aviso del centro.')}
            ${paso(3, c.tercero.valor, '¿Es a propósito?', 'En los de «Para revisar», pulsa «Dar por bueno» y no volverá a salir.')}
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:22px 28px 26px;">
      <a href="${cx.urlPublica}/panel?problemas=1" style="display:inline-block;background:${c.principal.valor};color:#ffffff;font-weight:800;font-size:15px;padding:12px 22px;border-radius:10px;text-decoration:none;${TIPO}">Ver mis enlaces con problemas</a>
    </td></tr>
    <tr><td style="padding:16px 28px 22px;border-top:1px solid #e1e4ec;font-size:12px;line-height:1.5;color:#6a6f7d;${TIPO}">
      Aviso automático de ${esc(cx.dominio)}${cx.pie ? ` · ${esc(cx.pie)}` : ''}. Llega el primer lunes de cada mes y solo si tienes algo nuevo que revisar.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const lineas = (lista: EnlaceDelInforme[]) => lista.map(e => {
    const por = e.tipo === 'pagina' && e.elementos.length
      ? e.elementos.map(x => `    - ${x.titulo}: ${x.problema_detalle}`).join('\n')
      : `    ${e.problema_detalle ?? ''}`;
    return `  • ${marcar && e.nuevo ? '[NUEVO] ' : ''}${e.titulo} (${corta(e)})\n${por}\n    Arreglarlo: ${ficha(e)}`;
  }).join('\n\n');
  // Bloques separados por una línea en blanco; los que no tocan (sin rotos, sin avisos) no aparecen.
  const texto = [
    `Hola, ${nombrePila}:`,
    `${titular}.\n\n${intro}`,
    rotos.length ? `NO ABREN (${rotos.length})\n\n${lineas(rotos)}` : null,
    revisar.length ? `PARA REVISAR (${revisar.length})\n\n${lineas(revisar)}` : null,
    'Cómo se arregla:\n'
      + '  1. Cambia el destino por uno que funcione: lo que ya esté impreso llevará al nuevo.\n'
      + '  2. ¿Ya no se usa? Quita «Activo» para pausarlo.\n'
      + '  3. ¿Es a propósito? En los de «Para revisar», pulsa «Dar por bueno».',
    `Tus enlaces con problemas: ${cx.urlPublica}/panel?problemas=1`,
    `--\nAviso automático de ${cx.dominio}${cx.pie ? ` · ${cx.pie}` : ''}. Llega el primer lunes de cada mes y solo si tienes algo nuevo que revisar.`,
  ].filter(x => x !== null).join('\n\n');

  return { para: d.correo, asunto, texto, html };
}

// ---------------------------------------------------------------- Envío

let isotipo: Buffer | null | undefined;
function isotipoPng(): Buffer | null {
  if (isotipo === undefined) {
    try {
      isotipo = new resvg.Resvg(fs.readFileSync(ficheroDeMarca('isotipo.svg'), 'utf8'), { fitTo: { mode: 'width', value: 96 } }).render().asPng();
    } catch { isotipo = null; }
  }
  return isotipo;
}

export function contexto(urlPublica: string, pie: string): Contexto {
  return {
    dominio: new URL(urlPublica).host, urlPublica, pie, colores: cargarMarca().colores, conLogo: !!isotipoPng(),
    // El dibujo de fondo de la cabecera se sirve desde la propia app (ver servidor.ts).
    fondo: `${urlPublica}/marca/fondo-informe.png`,
  };
}

export async function enviarUno(cartero: Cartero, d: Destinatario, cx: Contexto, prueba = false): Promise<void> {
  const correo = componerInforme(d, cx, prueba);
  const logo = isotipoPng();
  if (cx.conLogo && logo) correo.adjuntos = [{ nombre: 'logo.png', contenido: logo, cid: 'isotipo', tipo: 'image/png' }];
  await cartero.enviar(correo);
}

/** Envía el informe del mes a quien le toque y no lo haya recibido ya. Devuelve cuántos se han enviado. */
export async function enviarInformes(bd: Bd, cartero: Cartero, mes: string, cx: Contexto): Promise<number> {
  const { rows } = await bd.query<{ usuario_id: number }>('select usuario_id from informes where mes = $1', [mes]);
  const yaEnviados = new Set(rows.map(r => r.usuario_id));
  let n = 0;
  for (const d of await destinatarios(bd)) {
    // Ya lo recibió este mes, o no hay nada nuevo desde el último: no se insiste.
    if (yaEnviados.has(d.id) || !d.enlaces.some(e => e.nuevo)) continue;
    try {
      await enviarUno(cartero, d, cx);
      await bd.query('insert into informes (usuario_id, mes, enlaces) values ($1, $2, $3) on conflict do nothing', [d.id, mes, d.enlaces.length]);
      n++;
    } catch (e) {
      // Se reintenta en la siguiente vuelta (cada hora), dentro del mismo mes.
      console.error(`Informe mensual a ${d.correo}:`, (e as Error).message);
    }
  }
  return n;
}

let enMarcha = false;

export function iniciarInformes(bd: Bd, cartero: Cartero | null, cx: () => Contexto): void {
  if (process.env.INFORME_MENSUAL === 'no') return;
  if (!cartero) {
    console.log('Informe mensual por correo desactivado: falta SMTP_USUARIO y SMTP_CONTRASENA.');
    return;
  }
  const vuelta = async () => {
    const { mes, toca } = momento();
    if (!toca || enMarcha) return;
    enMarcha = true;
    try {
      const n = await enviarInformes(bd, cartero, mes, cx());
      if (n) console.log(`Informe mensual ${mes}: ${n} correos enviados.`);
    } catch (e) {
      console.error('Informe mensual:', e);
    } finally {
      enMarcha = false;
    }
  };
  setTimeout(vuelta, 180_000).unref();
  setInterval(vuelta, 3600_000).unref();
}
