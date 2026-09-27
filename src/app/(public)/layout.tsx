import Link from "next/link";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-semibold text-brand-700">
            The Switchboard
          </Link>
          <Link href="/login" className="text-sm text-stone-600 hover:text-stone-900">
            Staff and clinician login
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
        <Link href="/privacy" className="underline">
          Privacy collection notice
        </Link>
      </footer>
    </div>
  );
}
