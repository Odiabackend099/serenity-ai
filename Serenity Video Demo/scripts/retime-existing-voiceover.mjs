import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const manifestPath = join(publicRoot, "assets", "audio", "audio-manifest.json");

const cadence = {
  intro: { atempo: 1.15, audioStartSeconds: 0, note: "Uses the raw ElevenLabs take with much less compression than the first cut." },
  discovery: { atempo: 0.94, audioStartSeconds: 7.4, note: "Slightly slower to make discovery feel calm and premium." },
  whatsapp: { atempo: 0.94, audioStartSeconds: 18, note: "Slower guided-booking narration for comprehension." },
  notifications: { atempo: 1.02, audioStartSeconds: 37, note: "Near-natural speed while staying aligned with the 12-second scene." },
  dashboard: { atempo: 0.96, audioStartSeconds: 49.6, note: "Small slowdown for operational clarity." },
  operations: { atempo: 0.92, audioStartSeconds: 61.4, note: "Slower staff-workflow explanation." },
  emergency: { atempo: 0.92, audioStartSeconds: 75, note: "Slower crisis language for a safer tone." },
  close: { atempo: 0.92, audioStartSeconds: 88, note: "Slower closing line with space for the ODIADEV AI sign-off." },
};

const main = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const scenes = [];

  for (const scene of manifest.scenes) {
    const spec = cadence[scene.key];
    if (!spec) {
      throw new Error(`No cadence spec for ${scene.key}`);
    }

    const sourcePath = join(publicRoot, scene.rawVoicePath);
    const outputPath = join(publicRoot, scene.voicePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing raw ElevenLabs clip: ${sourcePath}`);
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      sourcePath,
      "-af",
      `atempo=${spec.atempo},loudnorm=I=-14:TP=-1.5:LRA=11`,
      "-ar",
      "44100",
      "-b:a",
      "128k",
      outputPath,
    ]);

    const finalDurationSeconds = await mediaDuration(outputPath);
    scenes.push({
      ...scene,
      finalDurationSeconds,
      cadenceRetimed: true,
      cadenceAtempo: spec.atempo,
      audioStartSeconds: spec.audioStartSeconds,
      cadenceNote: spec.note,
      syncStatus:
        finalDurationSeconds <= scene.durationSeconds + 1.3
          ? "cadence_fit_with_breathing_room"
          : "review_required",
    });
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        cadenceUpdatedAt: new Date().toISOString(),
        cadenceStrategy:
          "Retimed existing raw ElevenLabs takes to reduce rushed delivery after the API key stopped allowing fresh TTS generation.",
        scenes,
      },
      null,
      2,
    )}\n`,
  );

  console.log("Retimed existing ElevenLabs clips for calmer cadence.");
};

const mediaDuration = async (filePath) => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filePath,
  ]);
  return Number(stdout.trim());
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
