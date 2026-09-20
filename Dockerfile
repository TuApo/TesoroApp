FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
# SSR emite index.csr.html y NO index.html. El service worker hashea los archivos
# del build, así que la copia tiene que ocurrir ANTES de generar ngsw.json: si se
# hace después (como se hacía en la etapa de nginx), el hash del index no casa y
# el navegador se queda sin poder servir la app desde la caché.
RUN npm run build:prod \
 && if [ -f dist/tesoreria/browser/index.csr.html ]; then \
      cp -f dist/tesoreria/browser/index.csr.html dist/tesoreria/browser/index.html; \
    fi \
 && ./node_modules/.bin/ngsw-config dist/tesoreria/browser ngsw-config.json './' \
 && cp node_modules/@angular/service-worker/ngsw-worker.js dist/tesoreria/browser/ngsw-worker.js

FROM nginx:alpine
COPY --from=builder /app/dist/tesoreria/browser /usr/share/nginx/html
RUN if [ -f /usr/share/nginx/html/index.csr.html ]; then \
      cp -f /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html; \
    fi
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
