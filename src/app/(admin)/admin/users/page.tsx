"use client";

import { useState, useEffect } from "react";
import {
  Users,
  Search,
  Shield,
  ShieldCheck,
  Crown,
  Eye,
  X,
  Globe,
  Calendar,
  FileText,
  CheckCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Lock,
  Unlock,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

type UserRole = "USER" | "CREATOR" | "ADMIN" | "SUPER_ADMIN";

interface ApiUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  isVerified: boolean;
  createdAt: string;
  _count?: { posts?: number };
}

const roleConfig: Record<
  UserRole,
  { color: string; bg: string; border: string; icon: typeof Shield }
> = {
  USER: {
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20",
    icon: Shield,
  },
  CREATOR: {
    color: "text-accent-strong",
    bg: "bg-brand-500/10",
    border: "border-brand-500/20",
    icon: ShieldCheck,
  },
  ADMIN: {
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
    icon: Crown,
  },
  SUPER_ADMIN: {
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/20",
    icon: Crown,
  },
};

const avatarColors = [
  "bg-brand-500/20 text-accent-strong",
  "bg-cyan-400/20 text-cyan-400",
  "bg-purple-400/20 text-purple-400",
  "bg-amber-400/20 text-amber-400",
  "bg-rose-400/20 text-rose-400",
  "bg-blue-400/20 text-blue-400",
];

export default function UsersManagement() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch users (${res.status})`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateUser(userId: string, updates: Partial<{ role: UserRole; isVerified: boolean }>) {
    try {
      setActionLoading(true);
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, ...updates }),
      });
      if (!res.ok) throw new Error("Update failed");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, ...updates } : u))
      );
      setSelectedUser((prev) =>
        prev && prev.id === userId ? { ...prev, ...updates } : prev
      );
    } catch {
    } finally {
      setActionLoading(false);
    }
  }

  const allRoles = Array.from(new Set(users.map((u) => u.role))).sort();

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      !searchQuery ||
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getAvatarColor = (index: number) =>
    avatarColors[index % avatarColors.length];

  const nodeDistribution = users.reduce<Record<string, number>>((acc, u) => {
    const uRecord = u as unknown as Record<string, unknown>;
    const node = uRecord.node;
    if (typeof node === "string") {
      acc[node] = (acc[node] || 0) + 1;
    }
    return acc;
  }, {});

  const nodeEntries = Object.entries(nodeDistribution).sort((a, b) => b[1] - a[1]);
  const maxNodeCount = nodeEntries[0]?.[1] ?? 1;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-400/10 border border-purple-400/20">
              <Users className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">
                User &amp; Node Management
              </h1>
              <p className="text-sm font-medium text-surface-300">
                Directory, roles, verification &amp; management
              </p>
            </div>
          </div>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
            <span className="ml-3 text-sm font-medium text-surface-300">Loading user directory...</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={fetchUsers}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-surface-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Filters */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or username..."
                  className="h-10 w-full rounded-lg bg-surface-900 border border-surface-800 pl-10 pr-4 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
                className="h-10 rounded-lg bg-surface-900 border border-surface-800 px-3 text-sm font-medium text-surface-100 outline-none transition-colors focus:border-brand-500/50"
              >
                <option value="all">All Roles</option>
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
              {/* User Directory Table */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-surface-800">
                        <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">
                          User
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">
                          Role
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">
                          Verified
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">
                          Joined
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-surface-400">
                          Posts
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-surface-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800/50">
                      {filteredUsers.map((user, i) => {
                        const rc = roleConfig[user.role] ?? roleConfig.USER;
                        return (
                          <tr
                            key={user.id}
                            className="group cursor-pointer transition-colors hover:bg-surface-800/30"
                            onClick={() => setSelectedUser(user)}
                          >
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <div
                                  className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                                    getAvatarColor(i)
                                  )}
                                >
                                  {user.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-surface-50">
                                    {user.name}
                                  </p>
                                  <p className="truncate text-xs text-surface-500">
                                    {user.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 type-caption border",
                                  rc.bg,
                                  rc.color,
                                  rc.border
                                )}
                              >
                                <rc.icon className="h-2.5 w-2.5" />
                                {user.role}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex justify-start">
                                {user.isVerified ? (
                                  <CheckCircle className="h-4 w-4 text-accent-strong" />
                                ) : (
                                  <div className="h-4 w-4 rounded-full border-2 border-surface-600" />
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-xs font-medium text-surface-300">
                              {formatDate(user.createdAt)}
                            </td>
                            <td className="px-5 py-3.5 text-right text-sm font-medium text-surface-50 tabular-nums">
                              {user._count?.posts ?? 0}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedUser(user);
                                }}
                                className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredUsers.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Users className="mb-3 h-8 w-8 text-surface-600" />
                    <p className="text-sm font-medium text-surface-300">
                      No users match your filters
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {/* Node Distribution */}
                {nodeEntries.length > 0 && (
                  <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Globe className="h-4 w-4 text-accent-strong" />
                      <h3 className="text-sm font-semibold text-surface-50">
                        Node Distribution
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {nodeEntries.map(([city, count]) => (
                        <div key={city}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-surface-200">{city}</span>
                            <span className="text-xs font-bold text-surface-50 tabular-nums">
                              {count}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-surface-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-brand-500 transition-all duration-500"
                              style={{
                                width: `${(count / maxNodeCount) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Role Summary */}
                <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="h-4 w-4 text-purple-400" />
                    <h3 className="text-sm font-semibold text-surface-50">
                      Role Breakdown
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {(Object.keys(roleConfig) as UserRole[]).map((role) => {
                      const count = users.filter((u) => u.role === role).length;
                      const rc = roleConfig[role];
                      return (
                        <div key={role} className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-800/30 p-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 type-caption border", rc.bg, rc.color, rc.border)}>
                              <rc.icon className="h-2.5 w-2.5" />
                              {role}
                            </span>
                          </div>
                          <span className="text-sm font-bold text-surface-50 tabular-nums">
                            {count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* User Detail Modal */}
            {selectedUser && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-2xl bg-surface-900 border border-surface-800 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
                    <h2 className="type-h2 text-surface-50">User Profile</h2>
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold",
                          getAvatarColor(
                            users.findIndex((u) => u.id === selectedUser.id)
                          )
                        )}
                      >
                        {selectedUser.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-lg font-bold text-surface-50">
                          {selectedUser.name}
                        </p>
                        <p className="text-sm font-medium text-surface-400">
                          @{selectedUser.username}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 type-caption border",
                              roleConfig[selectedUser.role].bg,
                              roleConfig[selectedUser.role].color,
                              roleConfig[selectedUser.role].border
                            )}
                          >
                            {(() => {
                              const Icon = roleConfig[selectedUser.role].icon;
                              return <Icon className="h-2.5 w-2.5" />;
                            })()}
                            {selectedUser.role}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Globe className="h-3 w-3 text-surface-500" />
                          <span className="type-caption text-surface-500">Email</span>
                        </div>
                        <p className="text-sm font-medium text-surface-50 truncate">
                          {selectedUser.email}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Calendar className="h-3 w-3 text-surface-500" />
                          <span className="type-caption text-surface-500">Joined</span>
                        </div>
                        <p className="text-sm font-medium text-surface-50">
                          {formatDate(selectedUser.createdAt)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <FileText className="h-3 w-3 text-surface-500" />
                          <span className="type-caption text-surface-500">Posts</span>
                        </div>
                        <p className="text-sm font-medium text-surface-50">
                          {selectedUser._count?.posts ?? 0}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          {selectedUser.isVerified ? (
                            <ShieldCheck className="h-3 w-3 text-accent-strong" />
                          ) : (
                            <Shield className="h-3 w-3 text-surface-500" />
                          )}
                          <span className="type-caption text-surface-500">
                            Verified
                          </span>
                        </div>
                        <p className="text-sm font-medium text-surface-50">
                          {selectedUser.isVerified ? "Yes" : "No"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-500">ID:</span>
                      <span className="font-mono text-xs text-surface-400">
                        {selectedUser.id}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-surface-800 px-6 py-4">
                    <button
                      disabled={actionLoading}
                      onClick={() =>
                        handleUpdateUser(selectedUser.id, {
                          isVerified: !selectedUser.isVerified,
                        })
                      }
                      className="flex items-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2 text-xs font-medium text-accent-strong transition-colors hover:bg-brand-500/20 disabled:opacity-50"
                    >
                      {selectedUser.isVerified ? (
                        <>
                          <Lock className="h-3.5 w-3.5" />
                          Revoke Verification
                        </>
                      ) : (
                        <>
                          <Unlock className="h-3.5 w-3.5" />
                          Verify User
                        </>
                      )}
                    </button>
                    {selectedUser.role !== "ADMIN" && selectedUser.role !== "SUPER_ADMIN" && (
                      <button
                        disabled={actionLoading}
                        onClick={() =>
                          handleUpdateUser(selectedUser.id, {
                            role: selectedUser.role === "CREATOR" ? "USER" : "CREATOR",
                          })
                        }
                        className="flex items-center gap-2 rounded-lg bg-amber-400/10 border border-amber-400/20 px-4 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {selectedUser.role === "CREATOR" ? "Demote to User" : "Promote to Creator"}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="ml-auto rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
