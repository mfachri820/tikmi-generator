import Image from "next/image";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { ROLE_LABELS } from "@/lib/roles";

type Role = keyof typeof ROLE_LABELS;

const NAV: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Beranda" },
  { href: "/admin/ltdbb", label: "Data LTDBB" },
  { href: "/admin/bobot", label: "Bobot", adminOnly: true },
  { href: "/admin/pengguna", label: "Pengguna", adminOnly: true },
  { href: "/admin/aktivitas", label: "Aktivitas", adminOnly: true },
];

/** The shared top bar for every page outside the workbook grid (which keeps its own Excel-style bar). */
export function AppHeader({
  active,
  user,
}: {
  active: string;
  user: { name: string; role: Role };
}) {
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="IRA PJP — Bank Indonesia, ke Beranda">
          {/* Full wordmark from sm up; just the round mark on phones, where the nav needs the room. */}
          <Image src="/bi-mark.webp" alt="Bank Indonesia" width={30} height={30} priority unoptimized className="sm:hidden" />
          <Image
            src="/bi-logo.webp"
            alt="Bank Indonesia"
            width={163}
            height={32}
            priority
            unoptimized
            className="hidden h-8 w-auto sm:block"
          />
          <span className="hidden h-7 w-px bg-line-strong sm:block" />
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold tracking-tight text-ink">IRA PJP</span>
            <span className="hidden text-[11px] text-ink-3 sm:block">Individual Risk Assessment</span>
          </span>
        </Link>

        <nav className="flex h-full items-stretch gap-1 overflow-x-auto text-[13px]">
          {NAV.filter((item) => !item.adminOnly || user.role === "admin").map((item) => {
            const isActive = item.href === active;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex items-center whitespace-nowrap px-2.5 font-medium transition-colors ${
                  isActive ? "text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {item.label}
                {isActive && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-brand" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* A native disclosure: the menu works without client JavaScript. */}
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-ink-2 hover:bg-plane [&::-webkit-details-marker]:hidden">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {initials}
              </span>
              <span className="hidden md:inline">{user.name}</span>
              <span className="text-[10px] text-ink-3 transition group-open:rotate-180">▼</span>
            </summary>
            <div className="card absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden py-1 text-[13px]">
              <div className="border-b border-line px-3 py-2">
                <p className="truncate font-medium text-ink">{user.name}</p>
                <p className="text-[12px] text-ink-3">{ROLE_LABELS[user.role]}</p>
              </div>
              <Link href="/akun" className="block px-3 py-2 text-ink-2 hover:bg-plane hover:text-ink">
                Akun saya
              </Link>
              <form action={logout}>
                <button type="submit" className="block w-full px-3 py-2 text-left text-ink-2 hover:bg-plane hover:text-ink">
                  Keluar
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
