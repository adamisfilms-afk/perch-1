// Demo data for local development and previews. NEVER run against production.
//   node --env-file=.env.local scripts/seed-demo.mjs
// Creates staff and clinician logins (password: see DEMO_PASSWORD), a small network of
// Sydney clinicians and families at each stage of the funnel.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD ?? "switchboard-demo-2026";
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
if (/supabase\.co/.test(url) && process.env.I_KNOW_THIS_IS_NOT_PRODUCTION !== "yes") {
  throw new Error("This looks like a hosted project. Set I_KNOW_THIS_IS_NOT_PRODUCTION=yes if it's a throwaway preview.");
}

const db = createClient(url, key, { auth: { persistSession: false } });
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function user(email, fullName, role) {
  const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return existing.id;
  const created = must(await db.auth.admin.createUser({ email, password, email_confirm: true }), `create ${email}`);
  must(await db.from("profiles").insert({ id: created.user.id, role, full_name: fullName, email }), `profile ${email}`);
  return created.user.id;
}

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function main() {
  const adminId = await user("admin@switchboard.test", "Adam Admin", "admin");
  await user("coordinator@switchboard.test", "Casey Coordinator", "coordinator");
  const leadId = await user("lead@switchboard.test", "Lee Clinical-Lead", "clinical_lead");

  const clinicians = [
    { name: "Priya Shah", email: "priya@switchboard.test", suburb: "Parramatta", postcode: "2150", lat: -33.815, lng: 151.0011, ndis: true, interests: ["stuttering", "early_intervention", "language"], gender: "female", languages: ["English", "Hindi"] },
    { name: "Tom Nguyen", email: "tom@switchboard.test", suburb: "Liverpool", postcode: "2170", lat: -33.92, lng: 150.9238, ndis: false, interests: ["speech_sounds", "literacy"], gender: "male", languages: ["English", "Vietnamese"] },
    { name: "Grace O'Brien", email: "grace@switchboard.test", suburb: "Chatswood", postcode: "2067", lat: -33.7969, lng: 151.1803, ndis: true, interests: ["autism", "aac", "social_communication"], gender: "female", languages: ["English"] },
    { name: "Mia Rossi", email: "mia@switchboard.test", suburb: "Bondi", postcode: "2026", lat: -33.8915, lng: 151.2767, ndis: false, interests: ["feeding", "language"], gender: "female", languages: ["English", "Italian"] },
    { name: "Sam Taylor (OT)", email: "sam@switchboard.test", suburb: "Blacktown", postcode: "2148", lat: -33.771, lng: 150.9057, ndis: true, profession: "occupational_therapist", interests: ["sensory", "fine_motor", "adhd"], gender: "male", languages: ["English"] },
  ];

  const ids = {};
  for (const c of clinicians) {
    const { data: existing } = await db.from("clinicians").select("id").eq("email", c.email).maybeSingle();
    if (existing) {
      ids[c.email] = existing.id;
      continue;
    }
    const userId = await user(c.email, c.name, "clinician");
    const row = must(
      await db
        .from("clinicians")
        .insert({
          user_id: userId,
          name: c.name,
          email: c.email,
          mobile: "+61412345678",
          profession: c.profession ?? "speech_pathologist",
          experience_years: 6,
          gender: c.gender,
          interests: c.interests,
          age_groups: ["0-2", "3-5", "6-12"],
          languages: c.languages,
          suburb: c.suburb,
          postcode: c.postcode,
          base_lat: c.lat,
          base_lng: c.lng,
          radius_km: 15,
          funding_types: ["private", "ndis_self_managed", "ndis_plan_managed", "medicare", ...(c.ndis ? ["ndis_agency_managed"] : [])],
          ndis_registered: c.ndis,
          capacity_new: 3,
          calcom_intro_url: `https://cal.com/${c.email.split("@")[0]}/intro`,
          status: "agreement_signed",
          clinical_lead_approved_by: leadId,
          clinical_lead_approved_at: new Date().toISOString(),
          abn: "51824753556",
          application: { submitted_at: ago(24 * 60) },
        })
        .select("id")
        .single(),
      `clinician ${c.name}`,
    );
    ids[c.email] = row.id;
    const creds = [
      [c.profession === "occupational_therapist" ? "ahpra" : "spa_cpsp", iso(200)],
      ["wwcc", iso(c.email.startsWith("tom") ? 20 : 600)],
      ["ndis_worker_screening", iso(900)],
      ["ndis_orientation", null],
      ["pi_insurance", iso(c.email.startsWith("mia") ? 45 : 250)],
      ["pl_insurance", iso(250)],
      ["abn", null],
    ];
    must(
      await db.from("credentials").insert([
        ...creds.map(([type, expires]) => ({ clinician_id: row.id, type, expires_at: expires, status: "verified", verified_at: new Date().toISOString(), verified_by: adminId, number: type === "abn" ? "51824753556" : null })),
        ...["drivers_licence", "car_insurance"].map((type) => ({ clinician_id: row.id, type, expires_at: iso(700), status: "verified", verified_at: new Date().toISOString(), verified_by: adminId, sighted_only: true, sighted_at: iso(-30) })),
      ], { defaultToNull: false }),
      "credentials",
    );
    must(await db.from("agreements").insert({ clinician_id: row.id, version: "2026-09", signed_at: new Date().toISOString() }), "agreement");
    must(
      await db.from("availability").insert([
        { clinician_id: row.id, day_of_week: 2, start_time: "15:00", end_time: "18:30" },
        { clinician_id: row.id, day_of_week: 4, start_time: "15:00", end_time: "18:30" },
        { clinician_id: row.id, day_of_week: 6, start_time: "08:00", end_time: "12:00" },
      ]),
      "availability",
    );
    must(await db.from("clinicians").update({ status: "active" }).eq("id", row.id), `activate ${c.name}`);
  }

  // A recruit part-way through onboarding, with a document waiting for verification.
  const { data: recruit } = await db.from("clinicians").select("id").eq("email", "jordan@switchboard.test").maybeSingle();
  if (!recruit) {
    const r = must(
      await db
        .from("clinicians")
        .insert({ name: "Jordan Lee", email: "jordan@switchboard.test", mobile: "+61400111222", profession: "speech_pathologist", experience_years: 2, suburb: "Hornsby", postcode: "2077", base_lat: -33.7047, base_lng: 151.0993, status: "documents_requested", application: { suburbs: "Hornsby, Asquith, Waitara", availability: "Mon and Wed after school", ndis_registration_status: "Not registered", referral_source: "Friend or family" } })
        .select("id")
        .single(),
      "recruit",
    );
    must(await db.from("credentials").insert({ clinician_id: r.id, type: "wwcc", number: "WWC1234567E", expires_at: iso(1500), status: "pending" }), "pending doc");
  }

  const { count } = await db.from("families").select("id", { count: "exact", head: true });
  if (count) {
    console.log("Families already seeded");
  } else {
    const fam = async (f, child, status, hoursAgo) => {
      const row = must(
        await db
          .from("families")
          .insert({ parent_name: f.parent, email: f.email, mobile: "+61412000111", suburb: f.suburb, postcode: f.postcode, state: "NSW", lat: f.lat, lng: f.lng, funding_type: f.funding, referral_source: f.source, status, status_changed_at: ago(hoursAgo), created_at: ago(hoursAgo + 30) })
          .select("id")
          .single(),
        `family ${f.parent}`,
      );
      const c = must(
        await db
          .from("children")
          .insert({ family_id: row.id, first_name: child.name, age_years: child.age, concerns: child.concerns, service_type: child.service ?? "speech", preferred_times: child.times ?? ["after_school"], language: child.language ?? null })
          .select("id")
          .single(),
        "child",
      );
      must(await db.from("consents").insert(["privacy_collection", "contact", "share_with_clinician"].map((type) => ({ family_id: row.id, type, version: "2026-09" }))), "consents");
      return { familyId: row.id, childId: c.id };
    };
    await fam({ parent: "Olivia Martin", email: "olivia@example.com", suburb: "Westmead", postcode: "2145", lat: -33.8076, lng: 150.9876, funding: "private", source: "Google search" }, { name: "Noah", age: 4, concerns: ["speech_sounds"] }, "new", 30);
    await fam({ parent: "Ahmed Hassan", email: "ahmed@example.com", suburb: "Auburn", postcode: "2144", lat: -33.8494, lng: 151.0331, funding: "ndis_plan_managed", source: "GP or paediatrician" }, { name: "Layla", age: 6, concerns: ["language", "social_communication"], language: "Arabic" }, "contacted", 20);
    await fam({ parent: "Chloe Wilson", email: "chloe@example.com", suburb: "Epping", postcode: "2121", lat: -33.7727, lng: 151.0819, funding: "ndis_agency_managed", source: "NDIS planner or support coordinator" }, { name: "Leo", age: 3, concerns: ["language"], times: ["school_hours"] }, "intake_booked", 10);
    await fam({ parent: "Emily Chen", email: "emily@example.com", suburb: "Harris Park", postcode: "2150", lat: -33.8226, lng: 151.0071, funding: "ndis_self_managed", source: "Facebook or Instagram" }, { name: "Ruby", age: 5, concerns: ["stuttering"] }, "ready_to_match", 6);
    await fam({ parent: "Jack Brown", email: "jack@example.com", suburb: "Cabramatta", postcode: "2166", lat: -33.8948, lng: 150.9363, funding: "private", source: "School or childcare" }, { name: "Mason", age: 7, concerns: ["literacy", "speech_sounds"], language: "Vietnamese" }, "ready_to_match", 60);
    const wait = await fam({ parent: "Sophie Clarke", email: "sophie@example.com", suburb: "Katoomba", postcode: "2780", lat: -33.7125, lng: 150.3119, funding: "ndis_agency_managed", source: "Google search" }, { name: "Isla", age: 4, concerns: ["feeding"] }, "waitlist", 200);
    must(await db.from("families").update({ waitlist_reason: "No NDIS-registered clinician available for Katoomba 2780: 5 outside service area.", waitlist_codes: ["area:2780", "funding:ndis_agency_managed", "profession:speech_pathologist", "blocker:service_area"] }).eq("id", wait.familyId), "waitlist");
  }
  console.log(`Done. Log in at /login with any of these (password "${password}"):`);
  console.log("  admin@switchboard.test, coordinator@switchboard.test, lead@switchboard.test");
  console.log("  priya@ / tom@ / grace@ / mia@ / sam@switchboard.test (clinicians)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
