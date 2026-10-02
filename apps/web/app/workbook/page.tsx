import { redirect } from "next/navigation";

/** The workbook list now lives on Beranda, with every PJP's stage and scores. */
export default function WorkbookIndexPage() {
  redirect("/");
}
