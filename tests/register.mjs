// Registers the resolve hook below so `node --test` can run the app's .ts
// source directly. The app is written for Next.js's bundler, which resolves
// extension-less imports ("./compute-value") and the "@/..." alias; Node's raw
// ESM resolver does neither. This hook fills only that gap. Test-only — it never
// runs in production and changes no product code.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
