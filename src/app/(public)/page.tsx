import { LinkButton } from "@/components/ui";

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Speech pathology and OT, matched to your family</h1>
        <p className="mt-3 text-stone-700">
          Tell us a little about your child and we&apos;ll connect you with an independent speech pathologist or occupational therapist
          who works near you, sees children like yours and accepts your funding.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton href="/enquire" variant="primary">
          Make an enquiry
        </LinkButton>
        <LinkButton href="/join">I&apos;m a clinician: join the network</LinkButton>
      </div>
    </div>
  );
}
