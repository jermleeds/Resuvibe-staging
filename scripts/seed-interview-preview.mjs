// Seed a ready-to-use application for previewing the Interview Prep feature.
//
// Creates (idempotently) a confirmed user past onboarding, plus one job
// application that already has a generated resume + JD — so you land directly on
// a working, UNLOCKED Interview Prep tab (no need to run the resume pipeline).
//
// Runs against whatever Supabase the env points at (local by default). Uses the
// SERVICE ROLE key, so ONLY point it at a local or throwaway/staging project —
// NEVER production.
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key from `supabase status`> \
//   node scripts/seed-interview-preview.mjs
//
// Optional: PREVIEW_EMAIL, PREVIEW_PASSWORD.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.PREVIEW_EMAIL || "preview@resuvibe.test";
const password = process.env.PREVIEW_PASSWORD || "preview-password-123";

if (!serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY. Get it from `supabase status` (local) and re-run.");
  process.exit(1);
}
if (/supabase\.co/.test(url) && !process.env.ALLOW_REMOTE) {
  console.error(`Refusing to seed a hosted project (${url}). Set ALLOW_REMOTE=1 only for a throwaway/staging project — never production.`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RESUME_HTML = `<h1>Jordan Avery</h1>
<p>Senior Technical Program Manager</p>
<h2>Experience</h2>
<ul>
  <li>Led a cross-functional platform migration across 6 teams, cutting deploy time 40%.</li>
  <li>Drove an ambiguous 0→1 data-privacy initiative to launch under a regulatory deadline.</li>
  <li>Coordinated stakeholders across eng, design, and legal to unblock a stalled roadmap.</li>
</ul>
<h2>Skills</h2>
<ul><li>Stakeholder alignment</li><li>Risk management</li><li>Roadmapping</li><li>Technical judgment</li></ul>`;

const JD = `# Senior Technical Program Manager
We need a TPM to drive complex cross-functional programs end to end.
Responsibilities: align stakeholders across engineering and product, manage
ambiguity, own delivery risk, and communicate status to leadership.
Requirements: 5+ years TPM experience, strong judgment under ambiguity,
excellent cross-functional influence.`;

async function findUserByEmail(addr) {
  // Paginate admin.listUsers until we find the address.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === addr);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log(`Seeding preview data into ${url} …`);

  let userId;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    const existing = await findUserByEmail(email);
    if (!existing) throw created.error;
    userId = existing.id;
    console.log(`• User already exists (${email})`);
  } else {
    userId = created.data.user.id;
    console.log(`• Created user ${email}`);
  }

  // Past-onboarding profile so the app skips the onboarding wizard.
  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      first_name: "Jordan",
      last_name: "Avery",
      approval_status: "active",
      onboarding_completed_at: new Date().toISOString(),
      resume_text: "Jordan Avery — Senior Technical Program Manager",
    },
    { onConflict: "id" },
  );
  if (profErr) console.warn(`  (profiles upsert warning: ${profErr.message})`);

  // Application with a generated resume + JD → Interview Prep tab is unlocked.
  const { data: app, error: appErr } = await admin
    .from("job_applications")
    .insert({
      user_id: userId,
      job_url: "https://example.com/jobs/senior-tpm",
      job_title: "Senior Technical Program Manager",
      company_name: "Northwind",
      job_description_markdown: JD,
      resume_html: RESUME_HTML,
      status: "complete",
      pipeline_stage: "interview",
    })
    .select("id")
    .single();
  if (appErr) throw appErr;

  console.log("\nDone. Preview it:");
  console.log(`  1) npm run dev`);
  console.log(`  2) Sign in as  ${email} / ${password}`);
  console.log(`  3) Open        /applications/${app.id}/interview-prep`);
  console.log("\n(The user is on the free tier with an unclaimed trial — 'Begin interview' spends it.)");
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message || e);
  process.exit(1);
});
