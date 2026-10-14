# enlaces-qr — imagen de producción. Node 24 ejecuta TypeScript directamente: no hay paso de compilación.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
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
