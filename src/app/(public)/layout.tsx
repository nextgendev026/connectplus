import PublicLayout from "@/components/layout/PublicLayout";

export const revalidate = 300;

export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicLayout>{children}</PublicLayout>;
}
