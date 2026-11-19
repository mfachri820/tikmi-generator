import { redirect } from "next/navigation";

/** The app starts at the PJP list. */
export default function Home() {
  redirect("/pjp");
}
