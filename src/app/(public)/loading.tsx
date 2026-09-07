import { Loader2 } from "lucide-react";

export default function PublicLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        <p className="text-sm text-surface-500">Loading...</p>
      </div>
    </div>
  );
}