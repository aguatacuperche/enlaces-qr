# enlaces-qr — imagen de producción. Node 24 ejecuta TypeScript directamente: no hay paso de compilación.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Node no sabe cuánta memoria tiene el contenedor (256 MB en docker-compose.yml) y, sin tope, deja crecer la basura
# hasta que el sistema lo mata en mitad de una ráfaga de visitas. Si se sube mem_limit, subir esto a la mitad.
ENV NODE_OPTIONS=--max-old-space-size=128
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY vistas ./vistas
COPY publico ./publico
COPY sql ./sql
COPY marca-ejemplo ./marca-ejemplo
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/salud || exit 1
CMD ["node", "src/servidor.ts"]
