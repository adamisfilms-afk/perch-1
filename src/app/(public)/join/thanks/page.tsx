import { Card, LinkButton } from "@/components/ui";
import { env } from "@/lib/env";

export const metadata = { title: "Application received" };

export default function Thanks() {
  return (
    <Card className="space-y-3">
      <h1 className="text-2xl font-semibold">Thanks for applying</h1>
      <p className="text-stone-700">
        The next step is a short screening call. If you&apos;d like, book a time now. Otherwise we&apos;ll be in touch within a few business days.
      </p>
      <LinkButton href={env.calcomRecruitmentUrl()} variant="primary">
        Book a screening call
      </LinkButton>
    </Card>
  );
}
