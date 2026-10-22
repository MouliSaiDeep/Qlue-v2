FROM public.ecr.aws/docker/library/node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN apk upgrade --no-cache && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
