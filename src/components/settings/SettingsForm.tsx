"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  Camera,
  Image as ImageIcon,
  Loader2,
  Save,
  UserRound,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsUser {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar: string | null;
  coverImage: string | null;
  bio: string;
  node: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
  posts: number;
  followers: number;
  following: number;
}

const inputCls =
  "w-full rounded-xl border border-surface-800 bg-surface-900/60 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-surface-400">
      {children}
    </label>
  );
}

export function SettingsForm({ user }: { user: SettingsUser }) {
  const [tab, setTab] = useState<"profile" | "security" | "integrations">("profile");
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio);
  const [node, setNode] = useState(user.node);
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [coverImage, setCoverImage] = useState<string | null>(user.coverImage);

  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Integrations state
  const [pollInterval, setPollInterval] = useState("30");
  const [activeFeeds, setActiveFeeds] = useState("10");
  const [isPolling, setIsPolling] = useState(false);
  const [rssError, setRssError] = useState<string | null>(null);
  const [analyticsKey, setAnalyticsKey] = useState("");
  const [savingAnalytics, setSavingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function uploadFile(kind: "avatar" | "cover", file: File) {
    setMessage(null);
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (kind === "avatar") setAvatar(data.url);
      else setCoverImage(data.url);
      setMessage({ kind: "ok", text: kind === "avatar" ? "Avatar uploaded" : "Cover uploaded" });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(null);
    }
  }

  async function saveProfile() {
    setMessage(null);
    const uname = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(uname)) {
      setMessage({ kind: "err", text: "Username must be 3-30 characters (letters, numbers, underscores)" });
      return;
    }
    if (bio.length > 500) {
      setMessage({ kind: "err", text: "Bio cannot exceed 500 characters" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username: uname, bio, node, avatar, coverImage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMessage({ kind: "ok", text: "Profile saved" });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveEmail() {
    setMessage(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage({ kind: "err", text: "Enter a valid email address" });
      return;
    }
    if (!currentPassword) {
      setMessage({ kind: "err", text: "Enter your current password to change the email" });
      return;
    }
    setSavingEmail(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), currentPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change email");
      setCurrentPassword("");
      setMessage({ kind: "ok", text: "Email updated" });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to change email" });
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePassword() {
    setMessage(null);
    if (newPassword.length < 8) {
      setMessage({ kind: "err", text: "New password must be at least 8 characters" });
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setMessage({ kind: "err", text: "New password must include a letter and a number" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "err", text: "Passwords do not match" });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ kind: "ok", text: "Password changed" });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to change password" });
    } finally {
      setSavingPassword(false);
    }
  }

  const startRssPoll = async () => {
    setMessage(null);
    setIsPolling(true);
    try {
      const res = await fetch("/api/rss/poll?interval=" + pollInterval, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "RSS poll failed");
      setMessage({ kind: "ok", text: "RSS poll started with " + pollInterval + "min interval" });
    } catch (err) {
      setRssError(err instanceof Error ? err.message : "RSS poll failed");
      setMessage({ kind: "err", text: "Failed to start RSS poll" });
    } finally {
      setIsPolling(false);
    }
  };

  const testAnalytics = async () => {
    setMessage(null);
    setSavingAnalytics(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analytics test failed");
      setMessage({ kind: "ok", text: "Analytics connection tested" });
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : "Analytics test failed");
      setMessage({ kind: "err", text: "Failed to test analytics" });
    } finally {
      setSavingAnalytics(false);
    }
  };

  const testWebhook = async () => {
    setMessage(null);
    setSavingWebhook(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Webhook test failed");
      setMessage({ kind: "ok", text: "Webhook connection tested" });
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : "Webhook test failed");
      setMessage({ kind: "err", text: "Failed to test webhook" });
    } finally {
      setSavingWebhook(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 rounded-xl border border-surface-800 bg-surface-900/50 p-1 w-fit">
        <button
          onClick={() => setTab("profile")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "profile"
              ? "bg-brand-500 text-white"
              : "text-surface-400 hover:text-surface-100"
          )}
        >
          <UserRound className="h-4 w-4" />
          Profile
        </button>
        <button
          onClick={() => setTab("security")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "security"
              ? "bg-brand-500 text-white"
              : "text-surface-400 hover:text-surface-100"
          )}
        >
          <Lock className="h-4 w-4" />
          Security
        </button>
        <button
          onClick={() => setTab("integrations")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "integrations" ? "bg-brand-500 text-white" : "text-surface-400 hover:text-surface-100"
          )}
        >
          <Sparkles className="h-4 w-4" />
          Integrations
        </button>
      </div>

      {message && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
            message.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {message.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {tab === "profile" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 overflow-hidden">
            <div className="relative h-44 w-full bg-gradient-to-br from-brand-500/25 via-accent-terracotta/15 to-surface-900">
              {coverImage ? (
                <Image src={coverImage} alt="Cover" fill className="h-full w-full object-cover" />
              ) : null}
              <button
                onClick={() => coverInput.current?.click()}
                className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-surface-900/90 px-3 py-1.5 text-xs font-medium text-surface-200 border border-surface-700 hover:bg-surface-800 transition-colors"
              >
                {uploading === "cover" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                Change cover
              </button>
              <input
                ref={coverInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile("cover", f);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="px-6 pb-6">
              <div className="-mt-10 flex items-end justify-between">
                <div className="relative">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-surface-900 bg-surface-800 overflow-hidden">
                    {avatar ? (
                      <Image src={avatar} alt="Avatar" width={96} height={96} className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-10 w-10 text-surface-500" />
                    )}
                  </div>
                  <button
                    onClick={() => avatarInput.current?.click()}
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white border-2 border-surface-900 hover:bg-brand-600 transition-colors"
                    aria-label="Change avatar"
                  >
                    {uploading === "avatar" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                  </button>
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile("avatar", f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <span className="rounded-full bg-surface-800 px-3 py-1 text-xs text-surface-400 border border-surface-700">
                  {user.isVerified ? "Verified" : "Unverified"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
            <h2 className="mb-5 font-display text-lg font-bold text-surface-50">Public profile</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Display name</FieldLabel>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div>
                <FieldLabel>Username</FieldLabel>
                <input
                  className={inputCls}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={30}
                />
                <p className="mt-1 text-[11px] text-surface-500">
                  connectplus.web.app/profile/{username}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <FieldLabel>Node / region</FieldLabel>
              <input
                className={inputCls}
                value={node}
                onChange={(e) => setNode(e.target.value)}
                placeholder="e.g. Nairobi, Kenya"
                maxLength={60}
              />
            </div>
            <div className="mt-5">
              <FieldLabel>Bio</FieldLabel>
              <textarea
                className={cn(inputCls, "min-h-28 resize-y")}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell readers about yourself"
                maxLength={500}
              />
              <p className="mt-1 text-right text-[11px] text-surface-500">{bio.length}/500</p>
            </div>
            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-all"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </button>
          </div>

          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
            <h2 className="mb-2 font-display text-lg font-bold text-surface-50">Account snapshot</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Stories", value: user.posts },
                { label: "Followers", value: user.followers },
                { label: "Following", value: user.following },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-surface-800 bg-surface-900/60 p-4 text-center">
                  <p className="text-2xl font-bold text-surface-50">{stat.value}</p>
                  <p className="mt-0.5 text-xs text-surface-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : tab === "security" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
            <h2 className="mb-1 font-display text-lg font-bold text-surface-50">Email address</h2>
            <p className="mb-5 text-sm text-surface-400">
              Changing your email requires your current password for security.
            </p>
            <div className="max-w-md">
              <FieldLabel>Email</FieldLabel>
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="mt-4 max-w-md">
              <FieldLabel>Current password</FieldLabel>
              <input
                className={inputCls}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Required to confirm changes"
              />
            </div>
            <button
              onClick={saveEmail}
              disabled={savingEmail}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-all"
            >
              {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update email
            </button>
          </div>

          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
            <h2 className="mb-1 font-display text-lg font-bold text-surface-50">Change password</h2>
            <p className="mb-5 text-sm text-surface-400">
              Use at least 8 characters with a mix of letters and numbers.
            </p>
            <div className="grid max-w-md gap-4">
              <div>
                <FieldLabel>Current password</FieldLabel>
                <input
                  className={inputCls}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>New password</FieldLabel>
                <input
                  className={inputCls}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Confirm new password</FieldLabel>
                <input
                  className={inputCls}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <button
              onClick={savePassword}
              disabled={savingPassword}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-all"
            >
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Change password
            </button>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-brand-500/20 bg-brand-500/5 p-5">
            <ShieldCheck className="h-5 w-5 text-brand-400 shrink-0 mt-0.5" />
            <p className="text-sm text-surface-300">
              Your account is secured with encrypted credentials. Note: display changes may not
              reflect in the navbar until your next sign-in.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
            <h2 className="mb-1 font-display text-lg font-bold text-surface-50">Integrations</h2>
            <p className="text-sm text-surface-500 mb-6">
              Connect third-party services to extend ConnectPlus functionality.
            </p>

            {/* RSS Feed Pulser */}
            <div className="rounded-2xl border border-surface-800/50 bg-surface-900/60 p-5 mb-6">
              <h3 className="mb-4 font-display text-sm font-bold text-surface-50">RSS Feed Pulser</h3>
              <p className="text-xs text-surface-400 mb-3">Automatically poll RSS feeds and import articles</p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Poll Interval (minutes)</label>
                  <input
                    type="number"
                    value={pollInterval}
                    onChange={(e) => setPollInterval(e.target.value)}
                    className={inputCls}
                    min="1"
                    max="1440"
                  />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Active Feeds</label>
                  <input
                    type="number"
                    value={activeFeeds}
                    onChange={(e) => setActiveFeeds(e.target.value)}
                    className={inputCls}
                    min="0"
                    max="50"
                  />
                </div>
              </div>
              <button
                onClick={startRssPoll}
                disabled={isPolling}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all"
              >
                {isPolling ? (
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Polling
                  </span>
                ) : (
                  "Start RSS Pulser"
                )}
              </button>
              {rssError && (
                <p className="mt-2 text-sm text-red-400">{rssError}</p>
              )}
            </div>

            {/* Analytics Service */}
            <div className="rounded-2xl border border-surface-800/50 bg-surface-900/60 p-5 mb-6">
              <h3 className="mb-4 font-display text-sm font-bold text-surface-50">Analytics Service</h3>
              <p className="text-xs text-surface-400 mb-3">Track post views and engagement metrics</p>
              <div className="mb-4">
                <label className="block text-xs text-surface-400 mb-1">API Key</label>
                <input
                  type="text"
                  value={analyticsKey}
                  onChange={(e) => setAnalyticsKey(e.target.value)}
                  className={inputCls}
                  placeholder="Enter your analytics API key"
                  maxLength={100}
                />
              </div>
              <button
                onClick={testAnalytics}
                disabled={savingAnalytics}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all"
              >
                {savingAnalytics ? (
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Test Connection"
                )}
              </button>
              {analyticsError && (
                <p className="mt-2 text-sm text-red-400">{analyticsError}</p>
              )}
            </div>

            {/* Custom Webhook */}
            <div className="rounded-2xl border border-surface-800/50 bg-surface-900/60 p-5">
              <h3 className="mb-4 font-display text-sm font-bold text-surface-50">Custom Webhook</h3>
              <p className="text-xs text-surface-400 mb-3">Receive real-time notifications for events</p>
              <div className="mb-4">
                <label className="block text-xs text-surface-400 mb-1">Webhook URL</label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className={inputCls}
                  placeholder="https://example.com/webhook"
                  maxLength={200}
                />
              </div>
              <button
                onClick={testWebhook}
                disabled={savingWebhook}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all"
              >
                {savingWebhook ? (
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Test Webhook"
                )}
              </button>
              {webhookError && (
                <p className="mt-2 text-sm text-red-400">{webhookError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}