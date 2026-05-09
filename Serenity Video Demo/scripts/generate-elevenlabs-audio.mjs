import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = join(root, "src", "SerenityDemo.tsx");
const rootPath = join(root, "src", "Root.tsx");
const voiceoverDir = join(root, "public", "assets", "audio", "voiceover");
const musicDir = join(root, "public", "assets", "audio", "music");
const manifestPath = join(root, "public", "assets", "audio", "audio-manifest.json");

const apiKey = process.env.ELEVENLABS_API_KEY;
const force = process.argv.includes("--force");
const skipMusicApi = process.argv.includes("--skip-music-api");

const sceneScripts = {
  intro:
    'After hours, patients still reach out. <break time="0.6s" /> Serenity Royale Hospital AI. <break time="0.4s" /> Created by ODIADEV AI.',
  discovery:
    'A patient in Abuja searches for rehabilitation support. <break time="0.4s" /> They find Serenity, and the next step is familiar: WhatsApp.',
  whatsapp:
    'Dr Ade responds calmly. <break time="0.35s" /> Then the AI guides a short booking flow: name, location, doctor, center, date, and time. <break time="0.4s" /> The request is captured after hours.',
  notifications:
    'Now the right people are informed. <break time="0.35s" /> The patient gets confirmation. The secretary gets action. Dr K gets oversight. And the selected doctor gets the summary.',
  dashboard:
    'Inside the dashboard, the team sees what matters: pending bookings, delivery status, calendar review, patient activity, and system readiness.',
  operations:
    'If no doctor was selected, staff can assign one. <break time="0.35s" /> Then confirm the appointment, retry alerts, and keep the patient informed.',
  emergency:
    'For crisis messages, the AI does not pretend to be a doctor. <break time="0.45s" /> It responds safely, gives urgent guidance, and escalates to the care team.',
  close:
    'Serenity AI keeps the hospital front door open. <break time="0.45s" /> Supporting patients. Protecting after-hours demand. Aligning the people responsible for care. <break time="0.55s" /> Powered by ODIADEV AI.',
};

const preferredVoiceNames = [
  "Aria",
  "Rachel",
  "Sarah",
  "Serena",
  "Matilda",
  "Bella",
  "Grace",
  "Hope",
  "River",
];

const musicPrompt =
  "Original instrumental background music for a premium healthcare AI product demo. Calm, reassuring, modern hospital technology mood. Soft piano, warm pads, gentle low pulse, subtle optimistic lift near the ending. No vocals, no lyrics, no artist references, no copyrighted style references, clean corporate documentary pacing.";

const main = async () => {
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is required in the environment.");
  }

  await mkdir(voiceoverDir, { recursive: true });
  await mkdir(musicDir, { recursive: true });

  const timing = await readTiming();
  const voice = await selectVoice();
  const scenes = [];

  for (const [index, scene] of timing.scenes.entries()) {
    const text = sceneScripts[scene.key];
    if (!text) {
      throw new Error(`Missing voiceover script for scene "${scene.key}".`);
    }

    const number = String(index + 1).padStart(2, "0");
    const rawPath = join(voiceoverDir, `${number}-${scene.key}.raw.mp3`);
    const finalPath = join(voiceoverDir, `${number}-${scene.key}.mp3`);
    const alignmentPath = join(voiceoverDir, `${number}-${scene.key}.alignment.json`);

    if (force || !existsSync(rawPath)) {
      const result = await generateSpeechWithTiming(voice.voice_id, text);
      await writeFile(rawPath, Buffer.from(result.audio_base64, "base64"));
      await writeFile(
        alignmentPath,
        JSON.stringify(
          {
            scene: scene.key,
            voice: {
              id: voice.voice_id,
              name: voice.name,
            },
            alignment: result.alignment,
            normalized_alignment: result.normalized_alignment,
          },
          null,
          2,
        ),
      );
    }

    const rawDurationSeconds = await mediaDuration(rawPath);
    const maxVoiceSeconds = Math.max(1, scene.durationSeconds - 0.35);
    const requestedSpeedFactor = rawDurationSeconds > maxVoiceSeconds ? rawDurationSeconds / maxVoiceSeconds : 1;
    const appliedSpeedFactor = Math.min(requestedSpeedFactor, 1.35);
    await normalizeVoiceClip(rawPath, finalPath, appliedSpeedFactor);
    const finalDurationSeconds = await mediaDuration(finalPath);

    scenes.push({
      ...scene,
      text,
      voicePath: publicPath(finalPath),
      rawVoicePath: publicPath(rawPath),
      alignmentPath: publicPath(alignmentPath),
      rawDurationSeconds,
      finalDurationSeconds,
      requestedSpeedFactor,
      appliedSpeedFactor,
      syncStatus:
        finalDurationSeconds <= scene.durationSeconds
          ? "fits_scene"
          : "exceeds_scene_review_required",
    });
  }

  const music = await createMusicBed();
  const manifest = {
    generatedAt: new Date().toISOString(),
    fps: timing.fps,
    totalFrames: timing.totalFrames,
    durationSeconds: timing.totalFrames / timing.fps,
    voice: {
      id: voice.voice_id,
      name: voice.name,
      category: voice.category ?? null,
      labels: voice.labels ?? {},
      model: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    },
    music,
    scenes,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${scenes.length} voiceover clips using ${voice.name}.`);
  console.log(`Audio manifest: ${publicPath(manifestPath)}`);
  console.log(`Music bed: ${music.path}`);
};

const readTiming = async () => {
  const source = await readFile(sourcePath, "utf8");
  const rootSource = await readFile(rootPath, "utf8");
  const fps = Number(rootSource.match(/fps=\{(\d+)\}/)?.[1] ?? 30);
  const totalFrames = Number(rootSource.match(/durationInFrames=\{(\d+)\}/)?.[1] ?? 3000);
  const block = source.match(/const sceneStarts = \{([\s\S]*?)\};/);
  if (!block) {
    throw new Error("Could not find sceneStarts in SerenityDemo.tsx.");
  }

  const starts = [...block[1].matchAll(/(\w+):\s*(\d+)/g)]
    .map((match) => ({ key: match[1], startFrame: Number(match[2]) }))
    .sort((a, b) => a.startFrame - b.startFrame);

  const scenes = starts.map((scene, index) => {
    const next = starts[index + 1]?.startFrame ?? totalFrames;
    const durationFrames = next - scene.startFrame;
    return {
      key: scene.key,
      startFrame: scene.startFrame,
      startSeconds: scene.startFrame / fps,
      durationFrames,
      durationSeconds: durationFrames / fps,
    };
  });

  return { fps, totalFrames, scenes };
};

const selectVoice = async () => {
  if (process.env.ELEVENLABS_VOICE_ID) {
    return {
      voice_id: process.env.ELEVENLABS_VOICE_ID,
      name: process.env.ELEVENLABS_VOICE_NAME || "Provided voice",
      labels: {},
      category: "provided",
    };
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Could not list ElevenLabs voices: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const voices = data.voices ?? [];
  if (!voices.length) {
    throw new Error("No ElevenLabs voices were returned for this account.");
  }

  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
};

const scoreVoice = (voice) => {
  const haystack = `${voice.name ?? ""} ${JSON.stringify(voice.labels ?? {})}`.toLowerCase();
  let score = 0;
  preferredVoiceNames.forEach((name, index) => {
    if ((voice.name ?? "").toLowerCase() === name.toLowerCase()) {
      score += 100 - index * 3;
    } else if (haystack.includes(name.toLowerCase())) {
      score += 50 - index * 2;
    }
  });
  for (const token of ["female", "warm", "calm", "professional", "narration", "clear", "soft"]) {
    if (haystack.includes(token)) {
      score += 8;
    }
  }
  for (const token of ["child", "raspy", "shout", "monster", "character"]) {
    if (haystack.includes(token)) {
      score -= 25;
    }
  }
  return score;
};

const generateSpeechWithTiming = async (voiceId, text) => {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.66,
        similarity_boost: 0.8,
        style: 0.14,
        use_speaker_boost: true,
        speed: 0.92,
      },
      apply_text_normalization: "on",
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

const createMusicBed = async () => {
  const apiMusicRawPath = join(musicDir, "serenity-background-elevenlabs.raw.mp3");
  const canonicalMusicPath = join(musicDir, "serenity-background.mp3");

  if (!force && existsSync(canonicalMusicPath)) {
    return {
      source: "existing_music_bed",
      path: publicPath(canonicalMusicPath),
      durationSeconds: await mediaDuration(canonicalMusicPath),
      prompt: "Existing generated music bed.",
    };
  }

  if (!skipMusicApi && (force || !existsSync(canonicalMusicPath))) {
    try {
      const response = await fetchWithTimeout(
        "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            prompt: musicPrompt,
            music_length_ms: 100000,
            model_id: "music_v1",
            force_instrumental: true,
            sign_with_c2pa: false,
          }),
        },
        180000,
      );

      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }

      await writeFile(apiMusicRawPath, Buffer.from(await response.arrayBuffer()));
      await normalizeMusicBed(apiMusicRawPath, canonicalMusicPath);
      return {
        source: "elevenlabs_music_api",
        path: publicPath(canonicalMusicPath),
        rawPath: publicPath(apiMusicRawPath),
        durationSeconds: await mediaDuration(canonicalMusicPath),
        prompt: musicPrompt,
      };
    } catch (error) {
      console.warn(`Music API unavailable, using local original fallback: ${error.message}`);
    }
  }

  await createFallbackMusic(canonicalMusicPath);
  return {
    source: "local_original_fallback",
    path: publicPath(canonicalMusicPath),
    durationSeconds: await mediaDuration(canonicalMusicPath),
    prompt: "Local generated ambient healthcare-tech bed: soft pads, piano tones, and low pulse.",
  };
};

const createFallbackMusic = async (outputPath) => {
  const wavPath = join(dirname(outputPath), `${basename(outputPath, ".mp3")}.wav`);
  const sampleRate = 44100;
  const durationSeconds = 100;
  const channels = 2;
  const totalSamples = sampleRate * durationSeconds;
  const dataSize = totalSamples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  const chords = [
    [146.83, 220, 293.66, 369.99],
    [174.61, 261.63, 329.63, 440],
    [196, 246.94, 293.66, 392],
    [164.81, 246.94, 329.63, 392],
  ];

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const chord = chords[Math.floor(t / 12.5) % chords.length];
    const globalFade = Math.min(1, t / 4, (durationSeconds - t) / 5);
    const phrase = 0.74 + 0.26 * Math.sin((2 * Math.PI * t) / 16);
    const pulseEnvelope = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 1.2 * t)), 8);

    let sample = 0;
    chord.forEach((freq, index) => {
      const amp = 0.055 / (index + 1);
      sample += amp * Math.sin(2 * Math.PI * freq * t);
      sample += amp * 0.25 * Math.sin(2 * Math.PI * freq * 2 * t);
    });
    sample += 0.025 * Math.sin(2 * Math.PI * 55 * t) * pulseEnvelope;
    sample += 0.018 * Math.sin(2 * Math.PI * 880 * t) * Math.pow(Math.max(0, Math.sin(2 * Math.PI * 0.15 * t)), 5);
    sample *= globalFade * phrase;
    sample = Math.max(-0.95, Math.min(0.95, sample));

    const left = Math.round(sample * 32767);
    const right = Math.round(sample * 0.92 * 32767);
    const offset = 44 + i * channels * 2;
    buffer.writeInt16LE(left, offset);
    buffer.writeInt16LE(right, offset + 2);
  }

  await writeFile(wavPath, buffer);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    wavPath,
    "-af",
    "loudnorm=I=-28:TP=-2:LRA=10",
    "-ar",
    "44100",
    "-b:a",
    "128k",
    outputPath,
  ]);
  await unlink(wavPath).catch(() => undefined);
};

const normalizeVoiceClip = async (inputPath, outputPath, speedFactor) => {
  const filters = [];
  if (speedFactor > 1.01) {
    filters.push(`atempo=${Math.min(speedFactor, 1.35).toFixed(4)}`);
  }
  filters.push("loudnorm=I=-14:TP=-1.5:LRA=11");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-af",
    filters.join(","),
    "-ar",
    "44100",
    "-b:a",
    "128k",
    outputPath,
  ]);
};

const normalizeMusicBed = async (inputPath, outputPath) => {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-af",
    "loudnorm=I=-28:TP=-2:LRA=10,afade=t=in:st=0:d=4,afade=t=out:st=95:d=5",
    "-ar",
    "44100",
    "-b:a",
    "128k",
    outputPath,
  ]);
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

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const publicPath = (filePath) => filePath.replace(join(root, "public") + "/", "");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
