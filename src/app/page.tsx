import { redirect } from "next/navigation";

/** Internal tool: there's no home page. Signed-out visitors are sent to the login by the proxy. */
export default function Home() {
  redirect("/start");
}
