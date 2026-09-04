export default function AuthGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-950 bg-mesh-gradient p-4">
      {children}
    </div>
  );
}
