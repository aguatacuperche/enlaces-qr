/**
 * Envío de correo por SMTP (por ejemplo, el de Google Workspace con una contraseña de aplicación).
 * Sin SMTP_USUARIO y SMTP_CONTRASENA no se envía nada. Con CORREO_A_CARPETA (desarrollo y pruebas), los correos se
 * guardan como ficheros .eml y .html en esa carpeta en vez de enviarse.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

export type Correo = {
  para: string; asunto: string; texto: string; html: string;
  adjuntos?: { nombre: string; contenido: Buffer; cid: string; tipo: string }[];
};
export type Cartero = { remitente: string; enviar(c: Correo): Promise<void>; descripcion: string };

export function crearCartero(entorno: NodeJS.ProcessEnv = process.env, nombreRemitente = 'Enlaces'): Cartero | null {
  const carpeta = entorno.CORREO_A_CARPETA;
  const usuario = entorno.SMTP_USUARIO, contrasena = entorno.SMTP_CONTRASENA;
  const remitente = entorno.CORREO_REMITENTE || (usuario ? `${nombreRemitente} <${usuario}>` : `${nombreRemitente} <sin-remitente@localhost>`);
  const comun = (c: Correo) => ({
    from: remitente, to: c.para, subject: c.asunto, text: c.texto, html: c.html,
    attachments: c.adjuntos?.map(a => ({ filename: a.nombre, content: a.contenido, cid: a.cid, contentType: a.tipo })),
  });
  if (carpeta) {
    fs.mkdirSync(carpeta, { recursive: true });
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    return {
      remitente, descripcion: `guardar en ${carpeta}`,
      async enviar(c) {
        const r = await t.sendMail(comun(c)) as { message: Buffer };
        const base = path.join(carpeta, `${Date.now()}-${c.para.replace(/[^\w.@-]+/g, '_')}`);
        fs.writeFileSync(base + '.eml', r.message);
        fs.writeFileSync(base + '.html', c.html);
      },
    };
  }
  if (!usuario || !contrasena) return null;
  // 587 con STARTTLS por defecto: hay proveedores (Hetzner, por ejemplo) que bloquean la salida al 465 y al 25.
  // En cualquier caso, la conexión va siempre cifrada.
  const puerto = Number(entorno.SMTP_PUERTO || 587);
  const t = nodemailer.createTransport({
    host: entorno.SMTP_HOST || 'smtp.gmail.com', port: puerto, secure: puerto === 465, requireTLS: puerto !== 465,
    auth: { user: usuario, pass: contrasena },
  });
  return {
    remitente, descripcion: `SMTP ${entorno.SMTP_HOST || 'smtp.gmail.com'} como ${usuario}`,
    async enviar(c) { await t.sendMail(comun(c)); },
  };
}
