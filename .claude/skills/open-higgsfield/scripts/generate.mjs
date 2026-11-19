#!/usr/bin/env node
// Open Higgsfield generation CLI. Zero dependencies, Node 18+.
// Catalog and request mapping are ported from
// https://github.com/wide-trace/open-higgsfield (src/generation/catalog, to-platform.ts).
//
//   node generate.mjs models [--json]
//   node generate.mjs generate --model <id> --prompt "<text>" [--set key=value]...
//        [--start URL] [--end URL] [--ref URL]... [--video URL]... [--audio URL]...
//        [--count 1-4] [--out DIR] [--dry-run] [--no-wait] [--no-download]
//   node generate.mjs status <request_id>... [--wait] [--out DIR] [--no-download]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://platform.higgsfield.ai";
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);
const POLL_INTERVAL_MS = 4000;
const POLL_DEADLINE_MS = 10 * 60_000;

// ---------------------------------------------------------------- catalog

const en = (values, def) => ({ type: "enum", values, default: def });
const range = (min, max, def) => ({ type: "range", min, max, default: def });
const bool = (def) => ({ type: "boolean", default: def });

const SOUL_ASPECT = ["9:16", "16:9", "4:3", "3:4", "1:1", "2:3", "3:2"];
const SEEDANCE_ASPECT = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const VIDEO_ASPECT = ["16:9", "9:16", "1:1"];

const t2v = (p) =>
  p.endsWith("/text-to-video")
    ? { text: p, image: p.replace(/\/text-to-video$/, "/image-to-video") }
    : { text: p };

const imageModel = (id, label, paths) => ({
  id, label, surface: "image", roles: { reference: 8 }, map: "paths", paths,
  settings: {
    aspectRatio: en(["auto", "1:1", "4:3", "3:4", "16:9", "9:16"], "1:1"),
    resolution: en(["1k", "2k", "4k"], "1k"),
  },
});

const videoModel = (id, label, roles, paths) => ({
  id, label, surface: "video", roles, map: "paths", paths,
  settings: {
    aspectRatio: en(VIDEO_ASPECT, "16:9"),
    resolution: en(["720p", "1080p"], "720p"),
    duration: range(4, 10, 5),
  },
});

const soulSettings = {
  aspectRatio: en(SOUL_ASPECT, "1:1"),
  resolution: en(["720p", "1080p"], "720p"),
  batchSize: en(["1", "4"], "1"),
  enhancePrompt: bool(false),
};
const kling3Settings = {
  aspectRatio: en(VIDEO_ASPECT, "16:9"),
  duration: range(3, 15, 5),
  sound: bool(true),
  cfgScale: range(0, 1, 0.5),
  multiShots: bool(false),
};
const klingMotionSettings = {
  keepOriginalSound: bool(true),
  characterOrientation: en(["video", "image"], "video"),
};
const seedanceRoles = { start: 1, end: 1, reference: 9, video: 3, audio: 3 };
const seedance2Settings = (resolutions) => ({
  aspectRatio: en(SEEDANCE_ASPECT, "16:9"),
  duration: range(4, 15, 5),
  generateAudio: bool(true),
  resolution: en(resolutions, "720p"),
});
const seedance25Settings = {
  resolution: en(["480p", "720p"], "720p"),
  generateAudio: bool(true),
  outputFormat: en(["mp4", "mov"], "mp4"),
};
const kling3 = (id, label, prefix) => ({
  id, label, surface: "video", roles: { start: 1, end: 1 }, settings: kling3Settings, map: "kling3", prefix,
});
const klingMotion = (id, label, p) => ({
  id, label, surface: "video", roles: { start: 1, video: 1 }, settings: klingMotionSettings, map: "klingMotion", path: p,
});
const seedance2 = (id, label, prefix, resolutions) => ({
  id, label, surface: "video", roles: seedanceRoles, settings: seedance2Settings(resolutions), map: "seedance", prefix,
});

const MODELS = [
  // image
  { id: "soul-2", label: "Soul 2", surface: "image", roles: {}, settings: soulSettings, map: "soul", path: "higgsfield-ai/soul/v2/standard" },
  { id: "soul-cinema", label: "Soul Cinema", surface: "image", roles: {}, settings: soulSettings, map: "soul", path: "higgsfield-ai/soul/cinema" },
  imageModel("flux-2", "Flux 2", { text: "flux-2-pro" }),
  imageModel("grok-imagine-2", "Grok Imagine 2.0", { text: "xai/grok-imagine-image-2.0" }),
  imageModel("ideogram-4", "Ideogram 4.0", { text: "ideogram/v4.0" }),
  imageModel("recraft-4.1", "Recraft 4.1", { text: "recraft/v4.1/text-to-image" }),
  imageModel("qwen-image-3", "Qwen Image 3", { text: "alibaba/qwen-image-3/text-to-image" }),
  imageModel("z-image-turbo", "Z-Image Turbo", { text: "z-image/turbo" }),
  // video
  {
    id: "seedance-2.5", label: "Seedance 2.5", surface: "video", map: "seedance", prefix: "bytedance/seedance-2.5",
    roles: { start: 1, end: 1, reference: 30, video: 10, audio: 10 },
    settings: { aspectRatio: en(SEEDANCE_ASPECT, "16:9"), duration: range(4, 30, 5), ...seedance25Settings },
  },
  {
    id: "seedance-2.5-edit", label: "Seedance 2.5 Edit", surface: "video", map: "seedanceSource",
    path: "bytedance/seedance-2.5/video-edit", withDuration: false,
    roles: { video: 1, reference: 30, audio: 10 }, settings: seedance25Settings,
  },
  {
    id: "seedance-2.5-extend", label: "Seedance 2.5 Extend", surface: "video", map: "seedanceSource",
    path: "bytedance/seedance-2.5/video-extend", withDuration: true,
    roles: { video: 1, reference: 30, audio: 10 },
    settings: { duration: range(4, 30, 5), ...seedance25Settings },
  },
  seedance2("seedance-2", "Seedance 2.0", "bytedance/seedance-2.0", ["480p", "720p", "1080p", "4k"]),
  seedance2("seedance-2-fast", "Seedance 2.0 Fast", "bytedance/seedance-2.0/fast", ["480p", "720p"]),
  seedance2("seedance-2-mini", "Seedance 2.0 Mini", "bytedance/seedance-2.0/mini", ["480p", "720p"]),
  {
    id: "kling-3-turbo", label: "Kling 3.0 Turbo", surface: "video", roles: { start: 1 }, map: "klingTurbo",
    settings: { aspectRatio: en(VIDEO_ASPECT, "16:9"), resolution: en(["720p", "1080p"], "720p"), duration: range(3, 15, 5) },
  },
  kling3("kling-3-std", "Kling 3.0 Standard", "kling-video/v3.0/std"),
  kling3("kling-3-pro", "Kling 3.0 Pro", "kling-video/v3.0/pro"),
  kling3("kling-3-4k", "Kling 3.0 4K", "kling-video/v3.0/4k"),
  klingMotion("kling-3-motion-std", "Kling 3.0 Motion Control", "kling-video/v3/motion-control/std"),
  klingMotion("kling-3-motion-pro", "Kling 3.0 Motion Control Pro", "kling-video/v3/motion-control/pro"),
  videoModel("wan-3", "Wan 3.0", { start: 1 }, t2v("alibaba/wan-3.0/text-to-video")),
  videoModel("wan-3-prime", "Wan 3.0 Prime", { start: 1 }, t2v("alibaba/wan-3.0-prime/text-to-video")),
  videoModel("wan-2.7", "Wan 2.7", { start: 1 }, t2v("wan/v2.7/text-to-video")),
  videoModel("wan-2.6", "Wan 2.6", { start: 1 }, t2v("wan/v2.6/text-to-video")),
  videoModel("flux-3", "Flux 3", { start: 1 }, t2v("blackforestlabs/flux-3/text-to-video")),
  videoModel("minimax-h3", "MiniMax H3", { start: 1 }, t2v("minimax/h3/text-to-video")),
  videoModel("minimax-hailuo-2.3", "MiniMax Hailuo 2.3", { start: 1 }, t2v("minimax/hailuo-2.3/standard/text-to-video")),
  videoModel("happy-horse-1", "Happy Horse 1.0", { start: 1 }, t2v("alibaba/happy-horse/text-to-video")),
  videoModel("happy-horse-1.1", "Happy Horse 1.1", { start: 1 }, t2v("alibaba/happy-horse/v1.1/text-to-video")),
  videoModel("kling-2.6", "Kling 2.6", { start: 1 }, t2v("kling-video/v2.6/pro/text-to-video")),
  videoModel("kling-2.5", "Kling 2.5", { start: 1 }, { image: "kling-video/v2.5-turbo/standard/image-to-video" }),
  videoModel("kling-o3", "Kling O3", { start: 1, end: 1 }, { firstLast: "kling-video/o3/first-last-frame" }),
  videoModel("kling-o1", "Kling O1 (Omni)", { start: 1, end: 1 }, { firstLast: "kling-video/omni/first-last-frame" }),
  videoModel("ltx-2.5-fast", "LTX 2.5 Fast", { start: 1 }, t2v("lightricks/ltx-2.5/text-to-video/fast")),
  videoModel("ltx-2.5-pro", "LTX 2.5 Pro", { start: 1 }, t2v("lightricks/ltx-2.5/text-to-video/pro")),
  videoModel("grok-imagine-video-1.5", "Grok Imagine Video 1.5", { reference: 8, video: 3 }, { reference: "xai/grok-imagine-video/v1.5/reference-to-video" }),
  videoModel("pixverse-6", "PixVerse 6", { start: 1 }, t2v("pixverse/v6/text-to-video")),
  videoModel("dop", "DoP", { start: 1 }, { image: "higgsfield-ai/dop/lite" }),
];

// ---------------------------------------------------------------- mapping

const opt = (key, value) => (value === undefined || value === null || (Array.isArray(value) && !value.length) ? {} : { [key]: value });

const MAPPERS = {
  soul: (m, p, s) => ({
    path: m.path,
    body: { prompt: p, batch_size: Number(s.batchSize), resolution: s.resolution, aspect_ratio: s.aspectRatio, enhance_prompt: s.enhancePrompt },
  }),
  klingTurbo: (m, p, s, media) => {
    const start = media.start[0];
    return {
      path: `kling-video/v3.0-turbo/${start ? "image" : "text"}-to-video`,
      body: { prompt: p, duration: s.duration, resolution: s.resolution, ...(start ? { image_url: start } : { aspect_ratio: s.aspectRatio }) },
    };
  },
  kling3: (m, p, s, media) => {
    const [start] = media.start, [end] = media.end;
    const body = { prompt: p, sound: s.sound ? "on" : "off", duration: s.duration, cfg_scale: s.cfgScale, multi_shots: s.multiShots };
    if (start) return { path: `${m.prefix}/image-to-video`, body: { ...body, image_url: start, ...opt("last_image_url", end) } };
    return { path: `${m.prefix}/text-to-video`, body: { ...body, aspect_ratio: s.aspectRatio } };
  },
  klingMotion: (m, p, s, media) => ({
    path: m.path,
    body: {
      prompt: p, ...opt("image_url", media.start[0]), ...opt("video_url", media.video[0]),
      keep_original_sound: s.keepOriginalSound ? "yes" : "no", character_orientation: s.characterOrientation,
    },
  }),
  seedance: (m, p, s, media) => {
    const shared = { prompt: p, resolution: s.resolution, generate_audio: s.generateAudio, duration: s.duration, ...opt("output_format", s.outputFormat) };
    const [start] = media.start, [end] = media.end;
    if (start) return { path: `${m.prefix}/image-to-video`, body: { ...shared, image_url: start, ...opt("end_image_url", end) } };
    if (media.reference.length || media.video.length || media.audio.length) {
      return {
        path: `${m.prefix}/reference-to-video`,
        body: { ...shared, aspect_ratio: s.aspectRatio, ...opt("image_urls", media.reference), ...opt("video_urls", media.video), ...opt("audio_urls", media.audio) },
      };
    }
    return { path: `${m.prefix}/text-to-video`, body: { ...shared, aspect_ratio: s.aspectRatio } };
  },
  seedanceSource: (m, p, s, media) => {
    const [video, ...extra] = media.video;
    return {
      path: m.path,
      body: {
        prompt: p, resolution: s.resolution, generate_audio: s.generateAudio,
        ...(m.withDuration ? { duration: s.duration } : {}), ...opt("output_format", s.outputFormat),
        ...opt("video_url", video), ...opt("image_urls", media.reference), ...opt("video_urls", extra), ...opt("audio_urls", media.audio),
      },
    };
  },
  paths: (m, p, s, media) => {
    const spec = m.paths;
    const [start] = media.start, [end] = media.end;
    const refs = media.reference, videos = media.video;
    const body = { prompt: p, ...opt("aspect_ratio", s.aspectRatio), ...opt("resolution", s.resolution), ...opt("duration", s.duration) };
    if (spec.firstLast && (start || end)) return { path: spec.firstLast, body: { ...body, ...opt("first_frame_url", start), ...opt("last_frame_url", end) } };
    if (spec.image && start) return { path: spec.image, body: { ...body, image_url: start, ...opt("last_image_url", end) } };
    if (spec.reference && (refs.length || videos.length)) return { path: spec.reference, body: { ...body, ...opt("image_urls", refs), ...opt("video_urls", videos) } };
    if (spec.text) return { path: spec.text, body: { ...body, ...opt("image_urls", refs) } };
    return { path: spec.image ?? spec.reference ?? spec.firstLast, body };
  },
};

function getModel(id) {
  const model = MODELS.find((m) => m.id === id);
  if (!model) fail(`Unknown model "${id}". Run: node generate.mjs models`);
  return model;
}

function parseSettings(model, raw) {
  for (const key of Object.keys(raw)) {
    if (!model.settings[key]) fail(`${model.id} has no setting "${key}". Valid: ${Object.keys(model.settings).join(", ")}`);
  }
  const out = {};
  for (const [key, field] of Object.entries(model.settings)) {
    const given = raw[key];
    if (given === undefined) { out[key] = field.default; continue; }
    if (field.type === "enum") {
      if (!field.values.includes(given)) fail(`${model.id}: ${key} must be one of ${field.values.join(" | ")} (got "${given}")`);
      out[key] = given;
    } else if (field.type === "range") {
      const n = Number(given);
      if (!Number.isFinite(n) || n < field.min || n > field.max) fail(`${model.id}: ${key} must be ${field.min}..${field.max} (got "${given}")`);
      out[key] = n;
    } else {
      if (!["true", "false"].includes(given)) fail(`${model.id}: ${key} must be true or false (got "${given}")`);
      out[key] = given === "true";
    }
  }
  return out;
}

function checkMedia(model, media) {
  for (const [role, urls] of Object.entries(media)) {
    const cap = model.roles[role] ?? 0;
    if (urls.length > cap) {
      fail(cap === 0
        ? `${model.id} does not accept "${role}" media. Accepts: ${describeRoles(model) || "no media"}`
        : `${model.id} accepts at most ${cap} "${role}" item(s), got ${urls.length}`);
    }
    for (const url of urls) if (!/^https:\/\//.test(url)) fail(`Media must be a public https URL, got "${url}"`);
  }
  const usesStart = model.map === "paths" && !model.paths.text && !model.paths.reference;
  if (usesStart && !media.start.length && !media.end.length) fail(`${model.id} is image-to-video only: pass --start <url>`);
  if (model.map === "paths" && !model.paths.text && model.paths.reference && !media.reference.length && !media.video.length) {
    fail(`${model.id} is reference-to-video only: pass --ref <url> or --video <url>`);
  }
  if (model.map === "seedanceSource" && !media.video.length) fail(`${model.id} needs a source video: pass --video <url>`);
  if (model.map === "klingMotion" && (!media.start.length || !media.video.length)) fail(`${model.id} needs both --start <image url> and --video <motion url>`);
}

const describeRoles = (m) => Object.entries(m.roles).map(([r, n]) => `${r}×${n}`).join(", ");
const describeSetting = ([k, f]) =>
  f.type === "enum" ? `${k}=${f.values.join("|")} (${f.default})`
  : f.type === "range" ? `${k}=${f.min}..${f.max} (${f.default})`
  : `${k}=true|false (${f.default})`;

// ---------------------------------------------------------------- platform

function credentials() {
  const apiKey = (process.env.HF_API_KEY ?? "").trim();
  const colon = apiKey.indexOf(":");
  if (colon <= 0 || colon === apiKey.length - 1) fail("Set HF_API_KEY to your platform key in the form id:secret");
  return { auth: `Key ${apiKey}`, baseUrl: (process.env.HF_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "") };
}

async function send(method, urlPath, body) {
  const { auth, baseUrl } = credentials();
  let response;
  try {
    response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(`Network error calling ${baseUrl}${urlPath}: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  let payload = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : typeof payload === "string" ? payload.slice(0, 300) : JSON.stringify(payload);
    throw new Error(`Platform ${method} ${urlPath} failed (${response.status}): ${detail}`);
  }
  return payload ?? {};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(requestId) {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let last = "";
  for (;;) {
    const data = await send("GET", `/requests/${encodeURIComponent(requestId)}/status`);
    const status = data.status ?? "unknown";
    if (status !== last) log(`${requestId}: ${status}`);
    last = status;
    if (TERMINAL.has(status)) return data;
    if (Date.now() > deadline) return { ...data, status: "timeout", error: "Still running after 10 minutes; check later with: status " + requestId };
    await sleep(POLL_INTERVAL_MS);
  }
}

function resultUrls(data) {
  const urls = [];
  for (const image of Array.isArray(data.images) ? data.images : []) if (typeof image?.url === "string") urls.push(image.url);
  if (typeof data.video?.url === "string") urls.push(data.video.url);
  return urls;
}

async function download(urls, outDir, stem) {
  await mkdir(outDir, { recursive: true });
  const files = [];
  for (const [i, url] of urls.entries()) {
    const response = await fetch(url);
    if (!response.ok) { log(`download failed (${response.status}): ${url}`); continue; }
    const type = response.headers.get("content-type") ?? "";
    const ext = path.extname(new URL(url).pathname) || (type.includes("video") ? ".mp4" : type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg");
    const file = path.join(outDir, `${stem}${urls.length > 1 ? `-${i + 1}` : ""}${ext}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    files.push(file);
  }
  return files;
}

async function settle(requestId, stem, flags) {
  const data = await waitFor(requestId);
  const urls = resultUrls(data);
  const result = { request_id: requestId, status: data.status, urls };
  if (data.error !== undefined) result.error = data.error;
  if (urls.length && !flags.noDownload) result.files = await download(urls, flags.out, `${stem}-${requestId.slice(0, 8)}`);
  return result;
}

// ---------------------------------------------------------------- cli

function log(message) { process.stderr.write(`${message}\n`); }
function fail(message) { log(`error: ${message}`); process.exit(2); }

function parseArgs(argv) {
  const flags = { set: {}, start: [], end: [], reference: [], video: [], audio: [], positional: [], out: "higgsfield-output", count: 1 };
  const media = { "--start": "start", "--end": "end", "--ref": "reference", "--video": "video", "--audio": "audio" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => (i + 1 < argv.length ? argv[++i] : fail(`${arg} needs a value`));
    if (media[arg]) flags[media[arg]].push(value());
    else if (arg === "--set") {
      const pair = value(), eq = pair.indexOf("=");
      if (eq <= 0) fail(`--set expects key=value, got "${pair}"`);
      flags.set[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    else if (arg === "--model") flags.model = value();
    else if (arg === "--prompt") flags.prompt = value();
    else if (arg === "--out") flags.out = value();
    else if (arg === "--count") flags.count = Number(value());
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--no-wait") flags.noWait = true;
    else if (arg === "--no-download") flags.noDownload = true;
    else if (arg === "--wait") flags.wait = true;
    else if (arg === "--json") flags.json = true;
    else if (arg.startsWith("--")) fail(`Unknown flag ${arg}`);
    else flags.positional.push(arg);
  }
  return flags;
}

function cmdModels(flags) {
  if (flags.json) return print(MODELS.map(({ id, label, surface, roles, settings }) => ({ id, label, surface, roles, settings })));
  for (const surface of ["image", "video"]) {
    console.log(`\n${surface.toUpperCase()}`);
    for (const m of MODELS.filter((x) => x.surface === surface)) {
      console.log(`  ${m.id}  —  ${m.label}`);
      console.log(`      media: ${describeRoles(m) || "none (text only)"}`);
      console.log(`      settings: ${Object.entries(m.settings).map(describeSetting).join("; ")}`);
    }
  }
}

async function cmdGenerate(flags) {
  if (!flags.model) fail("--model is required");
  if (!flags.prompt?.trim()) fail("--prompt is required");
  if (!Number.isInteger(flags.count) || flags.count < 1 || flags.count > 4) fail("--count must be 1..4");
  const model = getModel(flags.model);
  const media = { start: flags.start, end: flags.end, reference: flags.reference, video: flags.video, audio: flags.audio };
  checkMedia(model, media);
  const settings = parseSettings(model, flags.set);
  const { path: modelPath, body } = MAPPERS[model.map](model, flags.prompt, settings, media);

  if (flags.dryRun) return print({ dry_run: true, method: "POST", path: `/${modelPath}`, body, submissions: flags.count });

  const queued = [];
  for (let i = 0; i < flags.count; i++) {
    const data = await send("POST", `/${modelPath}`, body);
    if (typeof data.request_id !== "string") throw new Error(`Platform response missing request_id: ${JSON.stringify(data)}`);
    log(`submitted ${model.id} → ${data.request_id}`);
    queued.push(data.request_id);
  }
  if (flags.noWait) return print({ model: model.id, request_ids: queued });
  const results = await Promise.all(queued.map((id) => settle(id, model.id, flags)));
  print({ model: model.id, results });
  if (results.some((r) => r.status !== "completed")) process.exitCode = 1;
}

async function cmdStatus(flags) {
  if (!flags.positional.length) fail("status needs at least one request id");
  const results = await Promise.all(flags.positional.map(async (id) => {
    if (flags.wait) return settle(id, "result", flags);
    const data = await send("GET", `/requests/${encodeURIComponent(id)}/status`);
    return { request_id: id, status: data.status ?? "unknown", urls: resultUrls(data), ...(data.error !== undefined ? { error: data.error } : {}) };
  }));
  print({ results });
}

function print(value) { console.log(JSON.stringify(value, null, 2)); }

const [command, ...rest] = process.argv.slice(2);
const flags = parseArgs(rest);
try {
  if (command === "models") cmdModels(flags);
  else if (command === "generate") await cmdGenerate(flags);
  else if (command === "status") await cmdStatus(flags);
  else fail("Usage: generate.mjs <models|generate|status> — see the header of this file");
} catch (error) {
  log(`error: ${error.message}`);
  process.exit(1);
}
