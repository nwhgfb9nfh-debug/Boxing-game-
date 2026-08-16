import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build:artifact` sets ARTIFACT_BUILD=1 to produce a single
// self-contained HTML file (inlined JS/CSS, no external requests) that can
// be published as a Claude Artifact for phone testing. The normal
// `npm run build` stays a regular multi-file production build.
const isArtifactBuild = process.env.ARTIFACT_BUILD === "1";

export default defineConfig({
  base: "./",
  plugins: isArtifactBuild ? [viteSingleFile()] : [],
  build: {
    outDir: isArtifactBuild ? "dist-artifact" : "dist",
    assetsInlineLimit: isArtifactBuild ? Number.MAX_SAFE_INTEGER : 4096,
    cssCodeSplit: !isArtifactBuild,
  },
});
