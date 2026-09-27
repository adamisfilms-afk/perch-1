// Environment variables, read lazily so builds don't need secrets.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  cronSecret: () => process.env.CRON_SECRET,
  calcomIntakeUrl: () => process.env.CALCOM_INTAKE_URL ?? "https://cal.com/switchboard/intake",
  calcomRecruitmentUrl: () => process.env.CALCOM_RECRUITMENT_URL ?? "https://cal.com/switchboard/screening",
};
