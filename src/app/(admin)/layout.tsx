import AdminLayout from "@/components/layout/AdminLayout";

export const dynamic = "force-dynamic";

export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayout>{children}</AdminLayout>;
}
