import { createLogger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { storeMediaBytes, type StoredMedia } from "@/lib/media-storage";

/**
 * Real asset generation for the mind's visual tool.
 *
 * Before this, `generateVisualBrief` returned a good prompt and a typographic
 * SVG — useful, but not what "generate an image" means. This produces an actual
 * image file, stored, with a URL the app can use as a cover.
 *
 * Two providers, layered the same way `web-research` layers DuckDuckGo over
 * Wikipedia, because the platform has to work with and without a key:
 *
 *   1. **OpenAI Images** (`/v1/images/generations`, `gpt-image-1`) when an
 *      OpenAI key is configured. Highest quality, costs money.
 *   2. **Pollinations** — keyless, no account, returns real JPEG bytes at a
 *      deterministic URL. This is what makes the feature work out of the box on
 *      an install that has never configured a model key. Verified: 200,
 *      `image/jpeg`, valid JPEG magic bytes.
 *
 * Video is a separate story and is deliberately not pointed at the obvious
 * provider — see `generateVideo`.
 */

const log = createLogger("visual-studio");

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface GeneratedImage {
  ok: boolean;
  provider: "openai" | "pollinations";
  prompt: string;
  size: ImageSize;
  media: StoredMedia | null;
  url: string | null;
  error?: string;
  notes: string[];
}

export interface GeneratedVideo {
  ok: boolean;
  /** `unavailable` is a first-class outcome here, not a failure to hide. */
  status: "unavailable" | "submitted" | "completed";
  provider: string | null;
  jobId: string | null;
  progress: number | null;
  prompt: string;
  media: StoredMedia | null;
  reason?: string;
  notes: string[];
}

const DIMENSIONS: Record<ImageSize, { width: number; height: number }> = {
  "1024x1024": { width: 1024, height: 1024 },
  "1536x1024": { width: 1536, height: 1024 },
  "1024x1536": { width: 1024, height: 1536 },
};

/**
 * An editorial prompt for an East African publishing platform.
 *
 * The avoid-list is doing real work: default stock and generic image models
 * render this region as either safari or poverty, and both are wrong for a
 * story about a Nairobi fintech. Naming the setting and banning stock posing is
 * what keeps the output usable.
 */
export function buildImagePrompt(input: { title: string; city?: string | null; category?: string | null; format?: string }): string {
  const setting = input.city ? `${input.city}` : "an East African city (Nairobi, Kampala, Dar es Salaam or Kigali)";
  const framing = input.format === "short-form" ? "vertical 9:16 video still" : input.format === "feature" ? "wide 16:9 editorial frame" : "3:2 editorial frame";
  return [
    `Editorial photograph for a story titled "${input.title}".`,
    input.category ? `Section: ${input.category}.` : "",
    `Setting: ${setting} — real street, market, office or home context.`,
    `Framing: ${framing}. Natural daylight, documentary style, ${framing.includes("vertical") ? "close and energetic" : "shallow depth of field"}.`,
    "Subjects: East African people with accurate regional features and dress; no Western-default casting.",
    "Colour grade: warm, true to life, not over-saturated.",
    "No text, no captions, no watermarks, no logos, no borders.",
    "Avoid stock-photo posing, avoid safari clichés, avoid charity imagery.",
  ]
    .filter(Boolean)
    .join(" ");
}

class VisualStudio {
  private readonly log = createLogger("visual-studio");

  /** True when an OpenAI key exists, so images can be generated at full quality. */
  async hasImageModel(): Promise<boolean> {
    const key = await this.openAiKey();
    return key.length > 0;
  }

  private async openAiKey(): Promise<string> {
    const settings = await getSettings().catch(() => ({} as Record<string, string>));
    return settings.openaiApiKey || process.env.OPENAI_API_KEY || "";
  }

  /**
   * Generate and store one image.
   *
   * Never throws: a generation that cannot happen returns `ok: false` with the
   * reason and the prompt, because the caller is usually a chat turn that must
   * still answer. Tries OpenAI first when a key exists, then falls back to the
   * keyless provider — a key whose quota is exhausted should degrade to a real
   * image, not to an error.
   */
  async generateImage(input: { prompt: string; size?: ImageSize; ownerId: string; quality?: "low" | "medium" | "high" }): Promise<GeneratedImage> {
    const size = input.size ?? "1024x1024";
    const notes: string[] = [];

    const key = await this.openAiKey();
    if (key) {
      const viaOpenAi = await this.viaOpenAi({ key, prompt: input.prompt, size, ownerId: input.ownerId, quality: input.quality ?? "high" });
      if (viaOpenAi.media) return { ok: true, provider: "openai", prompt: input.prompt, size, media: viaOpenAi.media, url: viaOpenAi.media.url, notes };
      notes.push(`OpenAI Images unavailable (${viaOpenAi.error}) — fell back to the keyless provider.`);
    } else {
      notes.push("No OpenAI key configured, so the keyless provider was used. Quality is lower and the wait is longer.");
    }

    const viaPollinations = await this.viaPollinations({ prompt: input.prompt, size, ownerId: input.ownerId });
    if (viaPollinations.media) {
      return { ok: true, provider: "pollinations", prompt: input.prompt, size, media: viaPollinations.media, url: viaPollinations.media.url, notes };
    }

    return {
      ok: false,
      provider: "pollinations",
      prompt: input.prompt,
      size,
      media: null,
      url: null,
      error: viaPollinations.error ?? "no image provider was reachable",
      notes,
    };
  }

  /**
   * OpenAI Images. `gpt-image-1` returns base64 rather than a URL, so the bytes
   * are decoded and stored — which is also better than a provider URL that
   * expires.
   */
  private async viaOpenAi(input: { key: string; prompt: string; size: ImageSize; ownerId: string; quality: string }): Promise<{ media: StoredMedia | null; error?: string }> {
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1", prompt: input.prompt, n: 1, size: input.size, quality: input.quality }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Never log the key; the status and a short body are enough to diagnose.
        return { media: null, error: `HTTP ${res.status} ${body.slice(0, 160)}` };
      }

      const data = await res.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (typeof b64 !== "string" || b64.length === 0) return { media: null, error: "response carried no b64_json" };

      const bytes = Buffer.from(b64, "base64");
      const media = await storeMediaBytes({ bytes, mimeType: "image/png", kind: "generated", ownerId: input.ownerId });
      this.log.info("image generated", { provider: "openai", size: input.size, bytes: media.bytes });
      return { media };
    } catch (err) {
      return { media: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Pollinations. The URL *is* the request — a GET returns image bytes — so
   * there is no key, no quota and no JSON envelope. Generated images take
   * several seconds, hence the long timeout; it is a real generation, not a
   * proxy to a cached asset.
   */
  private async viaPollinations(input: { prompt: string; size: ImageSize; ownerId: string }): Promise<{ media: StoredMedia | null; error?: string }> {
    const dims = DIMENSIONS[input.size];
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(input.prompt)}` +
      `?width=${dims.width}&height=${dims.height}&nologo=true&safe=false`;

    let lastError = "no attempt was made";

    // Retried because this provider returns a transient 500 under load, with no
    // `Retry-After` and no explanation. Measured: the identical request failed
    // with a 500 and then succeeded on every one of four variants moments later.
    // A single attempt would have reported "generation unavailable" for a
    // provider that was simply busy, and the caller's only visible symptom would
    // be a missing image. Generation is already slow, so one extra attempt costs
    // little against the alternative of no asset at all.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });

        if (!res.ok) {
          lastError = `HTTP ${res.status} from the keyless image provider`;
          // 4xx other than 429 will not improve on a retry.
          if (res.status < 500 && res.status !== 429) break;
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
          continue;
        }

        const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
        if (!contentType.startsWith("image/")) {
          lastError = `provider returned ${contentType || "no content type"}, not an image`;
          break;
        }

        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length < 1024) {
          lastError = `provider returned ${bytes.length} bytes, too small to be an image`;
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
          continue;
        }

        const media = await storeMediaBytes({ bytes, mimeType: contentType, kind: "generated", ownerId: input.ownerId });
        this.log.info("image generated", { provider: "pollinations", size: input.size, bytes: media.bytes, attempt });
        return { media };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }

    return { media: null, error: lastError };
  }

  /**
   * Video generation.
   *
   * Deliberately NOT pointed at OpenAI's Sora, which is the obvious choice and
   * the wrong one: the API reference states the Sora API is *scheduled to
   * permanently shut down on 2026-09-24* — eight days after this was written.
   * Wiring it would hand the console a headline feature with a known expiry date
   * and no replacement, which is the same class of mistake as the dead model
   * defaults that were already cleaned out of the AI rosters.
   *
   * So this is a job-based adapter against any OpenAI-compatible video endpoint
   * the operator supplies (`VIDEO_API_URL` + `VIDEO_API_KEY`): submit, poll,
   * download, store. With none configured it reports `unavailable` and says why,
   * rather than pretending to have produced a clip.
   */
  async generateVideo(input: { prompt: string; ownerId: string; seconds?: 4 | 8 | 12; size?: ImageSize }): Promise<GeneratedVideo> {
    const base = (process.env.VIDEO_API_URL ?? "").replace(/\/$/, "");
    const key = process.env.VIDEO_API_KEY ?? "";
    const notes: string[] = [];

    if (!base || !key) {
      return {
        ok: false,
        status: "unavailable",
        provider: null,
        jobId: null,
        progress: null,
        prompt: input.prompt,
        media: null,
        reason: "No video provider is configured. Set VIDEO_API_URL and VIDEO_API_KEY to an OpenAI-compatible video endpoint to enable this.",
        notes: [
          "OpenAI's Sora API is deliberately not used as a default: its documentation states it shuts down permanently on 2026-09-24.",
          "The image generator does work today and needs no key.",
        ],
      };
    }

    try {
      const form = new FormData();
      form.append("model", process.env.VIDEO_MODEL ?? "sora-2");
      form.append("prompt", input.prompt);
      if (input.seconds) form.append("seconds", String(input.seconds));
      if (input.size) form.append("size", input.size);

      const submit = await fetch(`${base}/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });

      if (!submit.ok) {
        const body = await submit.text().catch(() => "");
        return {
          ok: false,
          status: "unavailable",
          provider: base,
          jobId: null,
          progress: null,
          prompt: input.prompt,
          media: null,
          reason: `Video provider rejected the job: HTTP ${submit.status} ${body.slice(0, 160)}`,
          notes,
        };
      }

      const job = await submit.json();
      const jobId: string | null = typeof job?.id === "string" ? job.id : null;
      if (!jobId) {
        return { ok: false, status: "unavailable", provider: base, jobId: null, progress: null, prompt: input.prompt, media: null, reason: "Video provider returned no job id", notes };
      }

      // Poll briefly. A clip takes minutes, so a chat turn must not block on it:
      // the caller is told the job id and can check back.
      let status: string = job?.status ?? "queued";
      let progress: number | null = typeof job?.progress === "number" ? job.progress : 0;
      for (let attempt = 0; attempt < 8 && status !== "completed" && status !== "failed"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const poll = await fetch(`${base}/videos/${jobId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
        if (!poll.ok) break;
        const state = await poll.json();
        status = state?.status ?? status;
        progress = typeof state?.progress === "number" ? state.progress : progress;
      }

      if (status !== "completed") {
        notes.push("Still rendering. Video takes minutes, so the job id was returned instead of blocking the request.");
        return { ok: true, status: "submitted", provider: base, jobId, progress, prompt: input.prompt, media: null, notes };
      }

      const content = await fetch(`${base}/videos/${jobId}/content`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120_000) });
      if (!content.ok) {
        return { ok: false, status: "submitted", provider: base, jobId, progress, prompt: input.prompt, media: null, reason: `Rendered, but the download failed with HTTP ${content.status}`, notes };
      }

      const bytes = Buffer.from(await content.arrayBuffer());
      const media = await storeMediaBytes({ bytes, mimeType: "video/mp4", kind: "generated", ownerId: input.ownerId });
      this.log.info("video generated", { bytes: media.bytes, jobId });

      return { ok: true, status: "completed", provider: base, jobId, progress: 100, prompt: input.prompt, media, notes };
    } catch (err) {
      return {
        ok: false,
        status: "unavailable",
        provider: base,
        jobId: null,
        progress: null,
        prompt: input.prompt,
        media: null,
        reason: err instanceof Error ? err.message : String(err),
        notes,
      };
    }
  }
}

export const visualStudio = new VisualStudio();
