---
name: open-higgsfield
description: Use when the user asks to generate, render or create an image or video with AI models such as Soul, Seedance, Kling, Wan, Flux, Ideogram, Recraft, Qwen, Z-Image, LTX, MiniMax Hailuo, PixVerse, Grok Imagine, Happy Horse or DoP, mentions Higgsfield or Open Higgsfield, wants text-to-image, text-to-video, image-to-video, first/last-frame, reference-to-video, motion control, video edit or video extend, or needs to check a generation request id.
---

# Open Higgsfield — generate images and video

Drives the same generation API as the [Open Higgsfield](https://github.com/wide-trace/open-higgsfield)
studio, from the command line: 38 models (8 image, 30 video), one script, no dependencies.

**The catalog is the source of truth.** Every model declares its own media roles and
settings; the script rejects anything a model does not declare. Read the model's line in
`models` before composing a request rather than guessing a setting name.

## Requirements

| Variable | Value |
| --- | --- |
| `HF_API_KEY` | Platform key as `id:secret`. Required. Never ask for it in chat, echo it, or write it to a file in the repo. |
| `HF_API_BASE_URL` | Optional. Generation API origin; defaults to `https://platform.higgsfield.ai`. |

If `HF_API_KEY` is missing, stop and tell the user to set it in the environment. In a
Claude cloud session, request it for the API host with the credential tool instead.

## Workflow

Run from this skill's directory (Node 18+).

1. **Pick a model**: `node scripts/generate.mjs models` lists every id with its media caps
   and settings as `name=allowed values (default)`.
2. **Dry-run**: add `--dry-run` to print the exact `POST` path and body without spending
   credits. Do this first for any model or setting you have not used in this session.
3. **Generate**: drop `--dry-run`. The script submits, polls every 4s (10-minute deadline),
   downloads results into `--out` (default `./higgsfield-output`) and prints JSON on stdout.
4. **Report** the saved file paths and the `request_id`. Result URLs expire on the
   platform's CDN, so the downloaded file is the durable copy.

```bash
# text-to-image, portrait, four results
node scripts/generate.mjs generate --model soul-2 --prompt "portrait of a lighthouse keeper, overcast light" \
  --set aspectRatio=9:16 --set batchSize=4

# image-to-video from a start frame, 8 seconds, no audio
node scripts/generate.mjs generate --model kling-3-pro --prompt "slow dolly in, fog rolling" \
  --start https://example.com/frame.png --set duration=8 --set sound=false
```

## Quick reference

| Need | Flag |
| --- | --- |
| Setting | `--set key=value`, repeatable; keys are camelCase exactly as `models` prints them |
| Start / end frame | `--start URL`, `--end URL` |
| Reference images | `--ref URL`, repeatable |
| Source or reference video, audio | `--video URL`, `--audio URL`, repeatable |
| Several results | `--count 2..4` (one submission each). Soul models use `--set batchSize=4` instead |
| Submit without waiting | `--no-wait`, then `status <request_id> --wait` |
| Check a request | `node scripts/generate.mjs status <request_id>...` |
| Skip download | `--no-download` |
| Machine-readable catalog | `models --json` |

The endpoint follows the media you attach, as in the studio:

| Model family | No media | `--start` | `--ref` / `--video` / `--audio` |
| --- | --- | --- | --- |
| Soul 2, Soul Cinema | text-to-image | not accepted | not accepted |
| Flux 2, Ideogram, Recraft, Qwen, Z-Image, Grok Imagine 2 | text-to-image | not accepted | references added to the same call |
| Kling 3 Turbo / Std / Pro / 4K | text-to-video | image-to-video (`--end` on Std/Pro/4K) | not accepted |
| Kling 3 Motion Control | — | needs `--start` **and** `--video` | — |
| Seedance 2.0 / 2.5 | text-to-video | image-to-video (+ `--end`) | reference-to-video |
| Seedance 2.5 Edit / Extend | — | — | needs `--video` (source) |
| Wan, Flux 3, MiniMax, Happy Horse, LTX, PixVerse, Kling 2.6 | text-to-video | image-to-video | not accepted |
| Kling 2.5, DoP | — | needs `--start` | — |
| Kling O1 / O3 | — | first/last frame (`--start`, `--end`) | — |
| Grok Imagine Video 1.5 | — | — | needs `--ref` or `--video` |

Terminal statuses: `completed`, `failed`, `nsfw`, `canceled`. Exit code is `0` when every
result completed, `1` on a failed result or API error, `2` on a rejected argument.

## Common mistakes

- **Passing a local file as media.** The API only reads public `https` URLs. Host the file
  first (the studio uses Vercel Blob); the script does not upload.
- **Guessing settings across models.** `duration` is 4–10 on most video models, 3–15 on
  Kling 3, 4–30 on Seedance 2.5; image models have no `duration`. Check `models`.
- **Using `--count` on Soul.** Soul batches natively: `--set batchSize=4` is one request
  with four images; `--count 4` would be four requests.
- **Treating `nsfw` or `failed` as a retryable glitch.** Report the status and the `error`
  field to the user; re-submitting the same prompt spends credits for the same outcome.
- **`fetch failed` behind a proxy.** Node ignores `HTTPS_PROXY` unless started with
  `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24+). If the host is blocked by the sandbox's
  network policy, say so; do not fabricate a result.
- **A 10-minute timeout is not a failure.** The run is still queued: keep the `request_id`
  and re-check with `status <id> --wait`.
