import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function timeAgo(date: Date | string): string {
  const now = new Date();
  const past = new Date(date);
  const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function estimateReadTime(content: string): number {
  const wordsPerMinute = 200;
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function generateExcerpt(content: string, maxLength = 160): string {
  const plain = content.replace(/<[^>]+>/g, "").replace(/[#*_~`]/g, "");
  return truncate(plain, maxLength);
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

const EAST_AFRICAN_CITIES = [
  "Nairobi",
  "Kampala",
  "Dar es Salaam",
  "Kigali",
  "Mombasa",
  "Juba",
  "Addis Ababa",
  "Moshi",
  "Arusha",
  "Entebbe",
];

export function getRandomNode(): string {
  return EAST_AFRICAN_CITIES[Math.floor(Math.random() * EAST_AFRICAN_CITIES.length)] ?? "Nairobi";
}

export const NODES = EAST_AFRICAN_CITIES;
