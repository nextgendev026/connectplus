import PublicLayout from "@/components/layout/PublicLayout";

export const dynamic = "force-dynamic";

export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicLayout>{children}</PublicLayout>;
}
