# Transcoder Container of tha-bay-web (M05c3, DL-232): ffmpeg ladder `cut@1` and the C2PA re-signer.
# Build context: this directory. Tool versions are pinned and recorded in spec/03-decisions-and-facts.md section 7.
#   ffmpeg 7:6.1.1-3ubuntu5  the version the recipe was measured with (research/gap-cutscene-delivery-playback.md section 2.4)
#   node 22.22.0             official tarball, checked against nodejs.org SHASUMS256.txt
#   @contentauth/c2pa-node 0.9.10 (MIT), locked in package-lock.json
# The base image is pinned by tag; pin its digest when the operator builds the first image (`docker buildx imagetools inspect`).
FROM ubuntu:24.04

ARG NODE_VERSION=22.22.0
ARG NODE_SHA256=9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils ffmpeg=7:6.1.1-3ubuntu5 \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY ladder.sh server.ts ./

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER 1000:1000
CMD ["node", "server.ts"]
