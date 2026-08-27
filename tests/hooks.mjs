// Module resolution hook for the test runner only. Two jobs:
//   1. Map the "@/..." path alias (defined in tsconfig) to the src/ folder.
//   2. Append ".ts" to an extension-less relative import when, and only when,
//      the default resolver can't find it — matching the bundler's behavior.
// It never rewrites a specifier that already resolves, so it can't mask a real
// missing-module error.

export async function resolve(specifier, context, nextResolve) {
  // "@/lib/x" -> <repo>/src/lib/x  (this file lives in <repo>/tests)
  if (specifier.startsWith("@/")) {
    const mapped = new URL("../src/" + specifier.slice(2), import.meta.url).href;
    return resolve(mapped, context, nextResolve);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const last = specifier.split("/").pop() ?? "";
    const hasExtension = /\.[a-z0-9]+$/i.test(last);
    if (
      (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
      !hasExtension
    ) {
      return nextResolve(specifier + ".ts", context);
    }
    throw err;
  }
}
