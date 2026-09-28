// Booking and availability pages: opened from links in emails, no login.
export default function BookingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-neutral-900">
      <header className="border-b border-neutral-200 px-4 py-4 md:px-8">
        <p className="text-lg font-bold tracking-tight">Perch</p>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
