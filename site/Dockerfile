# Stage 1: Build the Astro site
FROM node:22-alpine AS builder
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1

# Copy package files (from the website directory)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
RUN sed -i 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

USER 101:101
EXPOSE 5252
CMD ["nginx", "-g", "daemon off;"]
