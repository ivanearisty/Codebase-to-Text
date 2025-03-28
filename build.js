// build.js
const esbuild = require("esbuild");

const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"], 
  format: "cjs",
  platform: "node", 
  target: "node16",
  sourcemap: true,
  plugins: [],
};

if (isWatch) {
  buildOptions.watch = {
    onRebuild(error, result) {
      if (error) console.error("watch build failed:", error);
      else console.log("watch build succeeded.");
    },
  };
  console.log("Starting esbuild in watch mode...");
}

esbuild
  .build(buildOptions)
  .then(() => {
    if (!isWatch) {
      console.log("Build succeeded.");
    }
  })
  .catch((e) => {
    console.error("Build failed:", e);
    process.exit(1);
  });
