import { providerStatus } from "@/lib/env";

/**
 * Build-status page. Replaced by the real landing/redirect in task #4 once
 * auth exists — until then it answers the question you'll actually be asking
 * for the next few days: which API keys have I got in yet?
 */
export default function Home() {
  let status: Record<string, boolean> = {};
  let bootError: string | null = null;

  try {
    status = providerStatus();
  } catch (err) {
    bootError = err instanceof Error ? err.message : String(err);
  }

  const core = [
    { name: "Supabase", ready: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    {
      name: "OpenRouter",
      ready: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL),
    },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs tracking-[0.15em] uppercase text-[var(--color-accent)]">
        Anna.ai · build in progress
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Describe a trip. Share one link. Plan it together.
      </h1>
      <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
        Nothing here yet — this page is a credential check while the app is
        being built.
      </p>

      {bootError && (
        <pre className="mt-8 overflow-x-auto rounded border border-[var(--color-over)] bg-[var(--color-over-soft)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--color-over)]">
          {bootError}
        </pre>
      )}

      <section className="mt-10">
        <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ink-faint)]">
          Required to boot
        </h2>
        <ul className="mt-3 divide-y divide-[var(--color-line)] rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
          {core.map((s) => (
            <StatusRow key={s.name} name={s.name} ready={s.ready} />
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ink-faint)]">
          Providers — checked when first called
        </h2>
        <ul className="mt-3 divide-y divide-[var(--color-line)] rounded border border-[var(--color-line)] bg-[var(--color-surface)]">
          {Object.entries(status).map(([name, ready]) => (
            <StatusRow key={name} name={name} ready={ready} />
          ))}
        </ul>
        <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-ink-faint)]">
          Open-Meteo (weather) and Frankfurter (currency) need no key, so
          they&rsquo;re always ready and not listed.
        </p>
      </section>
    </main>
  );
}

function StatusRow({ name, ready }: { name: string; ready: boolean }) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <span className="font-mono text-[13.5px]">{name}</span>
      <span
        className={
          "rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase " +
          (ready
            ? "bg-[var(--color-verified-soft)] text-[var(--color-verified)]"
            : "bg-[var(--color-suggested-soft)] text-[var(--color-suggested)]")
        }
      >
        {ready ? "ready" : "no key"}
      </span>
    </li>
  );
}
