/**
 * Row-level security test.
 *
 *   npx tsx scripts/test-rls.ts
 *
 * Creates two throwaway users, has A create a trip, and asserts that B cannot
 * see or touch it. Run this after every change to 0002_rls.sql.
 *
 * This is the single most important test in the codebase. A trip contains
 * where someone is going, when, and with whom — a leak here is not a bug
 * report, it's a disclosure. Everything else can be fixed after launch.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error(
    "Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env, then run with:  npx dotenv -e .env -- tsx scripts/test-rls.ts",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function makeUser(label: string) {
  const email = `rls-${label}-${Date.now()}@anna-test.local`;
  const password = crypto.randomUUID();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);

  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${label}): ${signInError.message}`);

  return { id: data.user.id, email, client };
}

async function main() {
  console.log("\nRLS test — two users, one trip\n");

  const a = await makeUser("a");
  const b = await makeUser("b");

  try {
    // ── A creates a trip ────────────────────────────────────────────────
    const { data: trip, error: createError } = await a.client
      .from("trips")
      .insert({ owner_id: a.id, destination: "Barcelona", title: "A's trip" })
      .select()
      .single();

    check("A can create a trip", !createError && Boolean(trip), createError?.message);
    if (!trip) throw new Error("cannot continue without a trip");

    // The enrol_trip_owner trigger should have made A a member.
    const { data: ownRead } = await a.client
      .from("trips")
      .select("id")
      .eq("id", trip.id)
      .maybeSingle();
    check("A can read their own trip", ownRead?.id === trip.id);

    // ── B must be shut out ──────────────────────────────────────────────
    const { data: bRead } = await b.client
      .from("trips")
      .select("id")
      .eq("id", trip.id)
      .maybeSingle();
    check(
      "B CANNOT read A's trip",
      bRead === null,
      bRead ? "LEAK — B read a trip they are not a member of" : "",
    );

    const { data: bList } = await b.client.from("trips").select("id");
    check(
      "B's trip list does not contain A's trip",
      !(bList ?? []).some((t) => t.id === trip.id),
    );

    const { error: bUpdate } = await b.client
      .from("trips")
      .update({ title: "hijacked" })
      .eq("id", trip.id);
    const { data: afterUpdate } = await admin
      .from("trips")
      .select("title")
      .eq("id", trip.id)
      .single();
    check(
      "B CANNOT modify A's trip",
      afterUpdate?.title === "A's trip",
      bUpdate ? "" : "update was silently accepted — check the UPDATE policy",
    );

    const { error: bJoin } = await b.client
      .from("trip_members")
      .insert({ trip_id: trip.id, user_id: b.id, role: "editor" });
    // B inserting *themselves* is allowed by policy — that is the join flow.
    // The protection is that B cannot discover the trip id without a share link.
    check(
      "B self-enrolling is permitted (join flow), and is the only way in",
      !bJoin,
      bJoin?.message,
    );

    // ── Items inherit the trip's policy ─────────────────────────────────
    const { data: item } = await a.client
      .from("itinerary_items")
      .insert({
        trip_id: trip.id,
        day_index: 0,
        type: "activity",
        title: "Sagrada Família",
      })
      .select()
      .single();
    check("A can add an itinerary item", Boolean(item));

    // Clean B out again so the read test is meaningful.
    await admin.from("trip_members").delete().eq("trip_id", trip.id).eq("user_id", b.id);

    const { data: bItems } = await b.client
      .from("itinerary_items")
      .select("id")
      .eq("trip_id", trip.id);
    check(
      "B CANNOT read A's itinerary items",
      (bItems ?? []).length === 0,
      (bItems ?? []).length > 0 ? "LEAK — items visible to a non-member" : "",
    );

    // ── The grounding constraint is enforced by the database ────────────
    const { error: badPrice } = await a.client.from("itinerary_items").insert({
      trip_id: trip.id,
      day_index: 0,
      type: "flight",
      title: "Invented flight",
      cost_cents: 42000,
      source: "generated", // a price with no real source
    });
    check(
      "A priced item with source='generated' is REJECTED",
      Boolean(badPrice),
      badPrice ? "" : "the priced_items_must_be_verified constraint is not firing",
    );
  } finally {
    await admin.auth.admin.deleteUser(a.id).catch(() => {});
    await admin.auth.admin.deleteUser(b.id).catch(() => {});
  }

  console.log(
    `\n${passed} passed, ${failed} failed\n` +
      (failed === 0
        ? "\x1b[32mRLS holds.\x1b[0m\n"
        : "\x1b[31mFix these before writing another line of feature code.\x1b[0m\n"),
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n\x1b[31mTest harness failed:\x1b[0m", err.message ?? err, "\n");
  process.exit(1);
});
