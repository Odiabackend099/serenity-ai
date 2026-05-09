# Serenity Royale Hospital AI Demo Video

This folder contains the Remotion source and rendered MP4 for the Serenity AI product demo.

## Final Video

- `serenity-royale-ai-demo.mp4`
- `serenity-royale-ai-demo-elevenlabs.mp4` after running the ElevenLabs audio workflow
- Duration: 100 seconds
- Format: 1920x1080, 30fps, H.264 video with AAC audio

## What The Video Shows

- Patient discovers Serenity Royale Hospital online.
- Patient clicks WhatsApp and starts chatting with Dr Ade, the AI assistant.
- AI captures an after-hours appointment request.
- Patient, secretary, Dr K, and selected doctor receive the right confirmations/alerts.
- Secretary confirms the appointment from the dashboard.
- Emergency escalation is routed to staff.
- Dashboard screens show Home, appointments, staff workflow, emergencies, and operational proof.

## Key Assets

- Serenity logo: `public/assets/serenity-logo.jpeg`
- ODIADEV AI logo: `public/assets/odiadev-ai.jpeg`
- Voiceover text: `public/assets/voiceover.txt`
- Voiceover audio: `public/assets/voiceover.mp3`
- ElevenLabs scene audio: `public/assets/audio/voiceover/`
- Background music bed: `public/assets/audio/music/serenity-background.mp3`
- Audio sync manifest: `public/assets/audio/audio-manifest.json`
- Dashboard screenshot: `public/screenshots/dashboard-home.png`

## Commands

```bash
npm install
ELEVENLABS_API_KEY=<your-key> npm run generate:audio
npm run retime:voiceover
npm run lint
npm run render
npm run render:elevenlabs
npm run mux:elevenlabs
```

`npm run mux:elevenlabs` is the fastest path after the visuals are already rendered: it keeps `serenity-royale-ai-demo.mp4` as the video source and replaces the audio with the synced ElevenLabs narration and music mix.

`npm run retime:voiceover` improves cadence using the existing raw ElevenLabs takes when fresh TTS generation is unavailable.

To preview or edit the video:

```bash
npm run dev
```

Then open Remotion Studio at the local URL shown in the terminal.
