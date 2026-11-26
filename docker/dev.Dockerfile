FROM node:24-slim
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
ENV PATH=$PNPM_HOME:$PATH
# The last step makes pnpm fetch its platform binary now, so the image runs offline.
RUN corepack enable && corepack prepare pnpm@12.23.0 --activate && pnpm --version
WORKDIR /repo
