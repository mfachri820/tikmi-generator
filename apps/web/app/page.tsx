import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="max-w-xl px-8 py-24 text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">IRA PJP</h1>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Phase 0 done: scoring engine and template export both proven against the real 2026 template.
        </p>
        <Link
          href="/workbook"
          className="mt-6 inline-block rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Buka demo A2 + KPMR
        </Link>
      </main>
    </div>
  );
}
