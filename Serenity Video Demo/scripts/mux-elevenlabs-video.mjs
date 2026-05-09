import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const manifestPath = join(publicRoot, "assets", "audio", "audio-manifest.json");
const inputVideo = join(root, "serenity-royale-ai-demo.mp4");
const outputVideo = join(root, "serenity-royale-ai-demo-elevenlabs.mp4");
const poweredByOverlay = join(publicRoot, "assets", "powered-by-odiadev-overlay.png");

const main = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const scenes = manifest.scenes;
  const musicPath = join(publicRoot, manifest.music.path);

  const inputs = ["-y", "-i", inputVideo];
  for (const scene of scenes) {
    inputs.push("-i", join(publicRoot, scene.voicePath));
  }
  inputs.push("-i", musicPath);
  inputs.push("-loop", "1", "-i", poweredByOverlay);

  const voiceLabels = scenes.map((scene, index) => {
    const inputIndex = index + 1;
    const delayMs = Math.round((scene.audioStartSeconds ?? scene.startSeconds) * 1000);
    return `[${inputIndex}:a]volume=0.94,adelay=${delayMs}:all=1[v${inputIndex}]`;
  });
  const musicInputIndex = scenes.length + 1;
  const overlayInputIndex = scenes.length + 2;
  const labels = scenes.map((_, index) => `[v${index + 1}]`).join("");
  const filter = [
    `[0:v][${overlayInputIndex}:v]overlay=(main_w-overlay_w)/2:main_h-220:enable='between(t,94,100)'[vout]`,
    ...voiceLabels,
    `[${musicInputIndex}:a]volume=0.72,atrim=0:${manifest.durationSeconds},asetpts=PTS-STARTPTS[m]`,
    `[m]${labels}amix=inputs=${scenes.length + 1}:duration=longest:normalize=0,atrim=0:${manifest.durationSeconds},loudnorm=I=-16:TP=-1.5:LRA=11[a]`,
  ].join(";");

  await execFileAsync(
    "ffmpeg",
    [
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-shortest",
      outputVideo,
    ],
    { maxBuffer: 1024 * 1024 * 10 },
  );

  console.log(`Created ${outputVideo}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
