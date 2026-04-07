FROM node:20-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
ARG NODE_ENV=development
RUN pnpm install --no-frozen-lockfile --prod=false

COPY . .

RUN pnpm build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=9000

EXPOSE 9000

CMD ["pnpm", "start"]
