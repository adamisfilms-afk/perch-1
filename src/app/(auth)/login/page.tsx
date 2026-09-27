import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      {error === "no-access" && <Alert tone="red">Your account doesn&apos;t have access. Ask an admin if you think this is wrong.</Alert>}
      <LoginForm next={typeof next === "string" ? next : ""} />
      <p className="text-sm">
        <Link href="/forgot" className="text-brand-700 underline">
          Forgot your password?
        </Link>
      </p>
    </Card>
  );
}
