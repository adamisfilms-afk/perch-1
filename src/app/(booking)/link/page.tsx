import { redirect } from "next/navigation";

// Older emails pointed clinicians here to get their link again. They now sign in with an emailed code.
export default function LinkPage() {
  redirect("/clinician");
}
