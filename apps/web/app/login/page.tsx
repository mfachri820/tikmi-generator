import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNext(next));

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#0f3d25]">
      {/* Backdrop: the app's green deepening into BI navy, a faint spreadsheet grid, and the BI mark as a watermark. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,#2a8a55_0%,#1b5e38_35%,#0f3d25_65%,#0b2a3f_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "64px 28px",
        }}
      />
      <Image
        src="/bi-mark.webp"
        alt=""
        width={520}
        height={520}
        unoptimized
        className="pointer-events-none absolute -bottom-24 -left-24 hidden opacity-[0.08] grayscale invert sm:block"
      />

      <div className="relative hidden flex-1 flex-col justify-center px-16 text-white sm:flex">
        <p className="text-[12.5px] font-medium uppercase tracking-[0.14em] text-white/70">Bank Indonesia · KPw DKI Jakarta</p>
        <h2 className="mt-3 max-w-md text-[34px] font-semibold leading-tight tracking-tight">Individual Risk Assessment PJP KI 3</h2>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/80">
          Formulir PJP, data LTDBB, dan penilaian pengawas dalam satu workbook, dengan nilai IRA yang dihitung langsung.
        </p>
      </div>

      {/* Sign-in panel on the right; full width on phones. */}
      <section className="relative ml-auto flex min-h-screen w-full flex-col justify-center bg-surface px-8 py-12 shadow-[-12px_0_40px_rgba(0,0,0,0.25)] sm:w-[440px] sm:px-12">
        <div className="mb-8">
          <Image src="/bi-logo.webp" alt="Bank Indonesia" width={204} height={40} priority unoptimized className="h-10 w-auto" />
          <h1 className="mt-8 text-[24px] font-semibold tracking-tight">Masuk ke IRA PJP</h1>
          <p className="mt-1 text-[14px] text-ink-2">Gunakan akun yang dibuat oleh admin.</p>
        </div>
        <LoginForm next={safeNext(next)} />
        <p className="mt-6 text-[12.5px] text-ink-3">Belum punya akun atau lupa password? Hubungi admin.</p>
      </section>
    </main>
  );
}
