import { z } from "zod";

/**
 * Environment access, split by when a variable is actually needed.
 *
 * The app is built incrementally and you will not have every API key on day
 * one. So only the variables required to *boot* are validated at startup;
 * per-provider keys are checked when that provider is first called, and fail
 * with a message telling you exactly which signup you still owe.
 *
 * Anything in `server` must never be imported from a client component. The
 * `NEXT_PUBLIC_` pair is the only part that is safe in the browser.
 */

const bootSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverBootSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  PROVIDER_MODE: z.enum(["live", "record", "replay"]).default("live"),
});

function fail(missing: string[], hint: string): never {
  throw new Error(
    `Missing environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}\n` +
      `${hint}\n` +
      `Copy .env.example to .env and fill it in.`,
  );
}

/**
 * Safe in the browser.
 *
 * Deliberately a function, not a module-level constant: evaluating this at
 * import time would throw during `next build` before a .env exists, taking
 * down every page that merely imports something else from this file.
 * Validation belongs at the point of use.
 */
export function publicEnv() {
  const parsed = bootSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    fail(
      parsed.error.issues.map((i) => String(i.path[0])),
      "Create a project at supabase.com, then copy the URL and anon key from Project Settings → API.",
    );
  }
  return parsed.data;
}

/** Server only. Importing this from a client component is a bug. */
export function serverEnv() {
  const parsed = serverBootSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    PROVIDER_MODE: process.env.PROVIDER_MODE ?? "live",
  });
  if (!parsed.success) {
    fail(
      parsed.error.issues.map((i) => String(i.path[0])),
      "SUPABASE_SERVICE_ROLE_KEY is in Supabase → Project Settings → API. " +
        "ANTHROPIC_API_KEY is at console.anthropic.com.",
    );
  }
  return parsed.data;
}

/**
 * Per-provider credentials, checked at call time rather than at boot.
 *
 * Each entry names the signup page, so a missing key produces an error you can
 * act on instead of `undefined is not a string` three frames deep in a fetch.
 */
const PROVIDERS = {
  amadeus: {
    vars: ["AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET"],
    where: "developers.amadeus.com — Self-Service tier, free, no card",
  },
  openrouteservice: {
    vars: ["ORS_API_KEY"],
    where: "openrouteservice.org — free, no card",
  },
  opentripmap: {
    vars: ["OTM_API_KEY"],
    where: "opentripmap.io — free, no card",
  },
  unsplash: {
    vars: ["UNSPLASH_ACCESS_KEY"],
    where: "unsplash.com/developers — free, no card",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

/**
 * Read a provider's credentials, throwing a useful error if they're absent.
 *
 *   const { AMADEUS_CLIENT_ID } = requireProvider("amadeus");
 */
export function requireProvider<K extends ProviderName>(
  name: K,
): Record<(typeof PROVIDERS)[K]["vars"][number], string> {
  const spec = PROVIDERS[name];
  const out = {} as Record<string, string>;
  const missing: string[] = [];

  for (const v of spec.vars) {
    const value = process.env[v];
    if (!value) missing.push(v);
    else out[v] = value;
  }

  if (missing.length > 0) {
    throw new Error(
      `${name} is not configured — missing ${missing.join(", ")}.\n` +
        `Get credentials at ${spec.where}, then add them to .env.`,
    );
  }
  return out as Record<(typeof PROVIDERS)[K]["vars"][number], string>;
}

/** Which providers are ready. Useful for a startup banner and for the eval script. */
export function providerStatus(): Record<ProviderName, boolean> {
  const status = {} as Record<ProviderName, boolean>;
  for (const name of Object.keys(PROVIDERS) as ProviderName[]) {
    status[name] = PROVIDERS[name].vars.every((v) => Boolean(process.env[v]));
  }
  return status;
}

export const amadeusBaseUrl = () =>
  process.env.AMADEUS_BASE_URL ?? "https://test.api.amadeus.com";

/** Blank until the affiliate application clears. Handoff works either way. */
export const travelpayoutsMarker = () => process.env.TRAVELPAYOUTS_MARKER ?? "";
