/**
 * Shown while Beranda scores every workbook on the server (about a second
 * today, longer as workbooks grow): the page's shape in quiet placeholders,
 * so the wait reads as loading rather than a blank screen.
 */
export default function Loading() {
  const block = "animate-pulse rounded-lg bg-track";
  return (
    <div className="min-h-screen" aria-busy="true" aria-label="Memuat">
      <div className="h-14 border-b border-line bg-surface" />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-9 sm:px-8">
        <div className="space-y-2">
          <div className={`${block} h-8 w-72`} />
          <div className={`${block} h-4 w-56`} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-[90px] p-5">
              <div className={`${block} h-full`} />
            </div>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-72 p-6">
              <div className={`${block} h-full`} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
