export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg font-semibold text-brand-700">The Switchboard</p>
      {children}
    </main>
  );
}
