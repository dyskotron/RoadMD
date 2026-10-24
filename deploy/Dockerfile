# roadmd serve for one project: the code in /app, the project's site (config, documents) in /site.
# Assembled by deploy/stage.mjs; see deploy/README.md.
FROM node:22-alpine
WORKDIR /app
COPY app/ /app/
COPY site/ /site/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "/app/roadmd.mjs", "serve", "--config", "/site/roadmd.config.json"]
