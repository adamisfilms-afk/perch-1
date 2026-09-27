export const metadata = { title: "Privacy collection notice" };

export default function Privacy() {
  return (
    <article className="space-y-4 text-sm leading-6 text-stone-800">
      <h1 className="text-2xl font-semibold">Privacy collection notice</h1>
      <p className="text-stone-500">Version 2026-09 · Draft: to be reviewed by our privacy lawyer before launch.</p>
      <h2 className="text-lg font-semibold">What we collect</h2>
      <p>
        Your name and contact details, your suburb and postcode, your child&apos;s first name and age, the main concerns you tell us about,
        your funding type and preferred times. On the intake call we may also note a little more about your child&apos;s needs so we can
        find the right clinician. We keep this to what we need to make a match. We don&apos;t keep clinical notes.
      </p>
      <h2 className="text-lg font-semibold">Why we collect it</h2>
      <p>To contact you, understand what your child needs, and refer you to a suitable independent clinician.</p>
      <h2 className="text-lg font-semibold">Who we share it with</h2>
      <p>
        Before a clinician accepts a referral, they only see your child&apos;s age, your suburb, the concerns, funding type and preferred
        times: never your name, contact details or address. Once they accept, we share your details with that clinician so they can
        contact you. Their clinical records are kept in their own practice software.
      </p>
      <p>
        We use service providers to run this service (hosting in Australia, email, SMS and booking). If we use an AI service to help
        rank clinicians, it only ever receives de-identified information, under terms that stop it keeping your data.
      </p>
      <h2 className="text-lg font-semibold">Where it&apos;s stored</h2>
      <p>In Australia, encrypted, with access limited to the people who need it and every access logged.</p>
      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>If you don&apos;t go ahead with a clinician, we delete or anonymise your details after 12 months.</p>
      <h2 className="text-lg font-semibold">Your choices</h2>
      <p>
        You can ask to see or correct your information, or withdraw your consent, at any time by emailing us. If you think we&apos;ve
        mishandled your information you can complain to us, and then to the Office of the Australian Information Commissioner.
      </p>
    </article>
  );
}
