# Walking Book — Quick Start

A friendly, experiential tool for book editors.

Edit and engage from anywhere, unplugged from your desk. Expand your creative boundaries on the go.

<!--
Media notes:
- Put screenshots/GIFs/short MP4s in: docs/media/
- Then link them from this README like: ![Alt text](docs/media/your-file.png)
-->

<!-- TODO: Add 60–90s “What is Walking Book?” video (top-of-page). -->
<!-- TODO: Add hero screenshot/GIF of the Reader + voice edit flow. -->

## What you do in Walking Book

- **Create a tape**: Turn your manuscript into a “Walking Book tape” (a `.walkingbook` / `.zip` file with narrated audio + timestamps).
- **Play + mark edits**: Listen in the Reader and record voice notes tied to the exact line you were hearing.
- **Export**: Download a Word `.docx` with your edits as native Word comments, or export a comments `.json` to merge into an existing DOCX.

## Quick start (first-time users)

### 1) Create a Walking Book tape (Google Colab)

Click **Create** in the app (or open the Colab notebook directly):

- Colab notebook link (used by the in-app Create button): `https://colab.research.google.com/drive/1Rxgki8JbduqqbcX9k63Z7T4jdXDVIZng?usp=sharing`

In the notebook you will:

- **Upload your manuscript** (or paste text, depending on the notebook step).
- **Pick a voice** (Walking Book offers 18 English voices; you can preview them in the app under **Voices**).
- **Run the cells** to generate audio + timestamps.
- **Download the output tape**: a `.walkingbook` file (it may download as `.zip`).

Important:

- **Do not unzip the tape.** The Reader expects a `.walkingbook` / `.zip` file exactly as downloaded.

<!-- TODO: Add screenshot of Colab notebook: “Run all” + final download step. -->

### 2) Load your tape in the Reader

- Open the app and press **Play**.
- If this is your first time, you’ll see an upload screen. Click **Upload & open reader** and select your `.walkingbook` / `.zip`.

Once loaded, your tape is stored **locally in your browser** (IndexedDB) until you export or wipe it.

<!-- TODO: Add screenshot of “Upload & open reader” empty state. -->

### 3) Listen + record edits

- Press **Play** to start narration.
- When you want to leave a note:
  - **Desktop**: click the **pencil / Edit** button to open the Voice Editor.
  - **Mobile + headphones**: press **pause** on your headphones; the app listens briefly for the word **“edit”**. Say “edit” to open the Voice Editor hands-free.
- In the Voice Editor:
  - choose an **Edit Type** (Line Edit / Section Edit / Dev Edit),
  - speak your note,
  - say **“I’m done”** (or stop recording), then **Save**.

Your edits appear in the **Edit Log** and are attached to the closest timestamped text segment.

<!-- TODO: Add screenshot of Reader with Edit Log (desktop). -->
<!-- TODO: Add screenshot of Voice Editor modal. -->

### 4) Get your edits back into Word

Open the menu → **Comment Studio**.

You have two main paths:

- **Download DOCX with comments (easy mode)**: generates a new `.docx` where your edits are already inserted as Word comments.
- **Merge into an existing DOCX (format-preserving mode)**:
  1) Download **Comments JSON** from Comment Studio (or use the current session comments),
  2) Upload your manuscript `.docx`,
  3) Click **Merge & Download DOCX**.

Tip: before wiping data or switching tapes, download a **Session backup** (so you can restore later).

<!-- TODO: Add screenshot of Comment Studio quick export buttons. -->
<!-- TODO: Add screenshot of merge inputs (DOCX + comments JSON). -->

## Offline mode (recommended for walking)

On the homepage, click **Use Offline**. This prepares the app for offline use and downloads the **Moonshine** speech model for on-device transcription.

- **Offline transcription**: when offline mode is ready, the Voice Editor transcribes edits on-device with Moonshine.
- **Online transcription**: if offline mode isn’t enabled/ready, the app uses your browser’s built-in speech recognition (behavior and network usage varies by browser).

<!-- TODO: Add screenshot of “Enable Offline Mode” download progress. -->

## What is a “Walking Book tape”?

A tape is just a zip file with a known structure. The Reader accepts either:

- **`.walkingbook`** (recommended), or
- **`.zip`** (the same thing, just a different extension)

Expected contents:

- `metadata.json` (title, author, etc.)
- `manifest.json` (chunk list + timestamps)
- audio files referenced by `manifest.json` (often under `audio/...`)
- optional: `version_history/*.txt` (original text for better Word-comment placement)
- optional: `session.json` and `edits/edit_<id>.webm` (when exporting a tape-with-session backup)

## Walking Book is for you

- **Complete control**: No AI suggestions or algorithmic interference. Just you, your words, and the freedom to think differently.
- **Neurodivergent editors & beyond**: Especially helpful for people who think better while moving — but useful for anyone who wants to break free from desk-bound editing. You can also use Walking Book on desktop, with OpenDyslexic font support.
- **Reduce cognitive load**: Listen instead of re-reading the same paragraphs over and over. Don’t accidentally read what you *meant* to write.

## Run locally (developers)

Prereqs: Node.js + npm.

```bash
npm install
npm run dev
```

Then open the URL printed by Next.js (usually `http://localhost:3000`).

## Privacy + your work stays yours

- **Everything local-first**: tapes, audio, and sessions live in your browser storage unless you export them.
- **No AI training**: your writing isn’t used to train models by Walking Book.
- **Open source**: Apache 2.0 license.

Network notes (so “privacy” stays concrete):

- **No manuscript uploads by the app**: there is no backend to send your manuscript/tape/session to.
- **External links/embeds**: the in-app **Create** button opens Google Colab, and the optional Quick Start guide can load from Gamma.
- **Speech recognition**:
  - **Moonshine (offline mode)** runs on-device (the model assets are served from this app’s own `/vendor/` path).
  - **Web Speech** (browser speech recognition) may be cloud-backed depending on your browser.

## 🤝 Be a Founding Human (The Vibe Check)

Walking Book is 100% local-first. I have zero app telemetry or analytics — I don't know if you're using it, what you're editing, or if the colors look right on your screen.

I am looking for **"Human Telemetry."** I want to hear about anything you experience — joy, friction, or unexpected uses.

How to help: send a quick **"Vibe Check"** email to **kate at sixpenny.org** (or email [`kate@sixpenny.org`](mailto:kate@sixpenny.org)). Just tell me:

- **The Setting**: Where did you take your Walking Book?
- **The Palette**: Which Riso color combo felt most "cozy" for your brain?
- **The Friction**: Where did the tech get in the way of your walk?
- **The Material**: Did you use it for a novel, a poem, or a dense textbook?

## 🛠️ Behind the Build (v0.8)

This is the third iteration of the system architecture. I originally explored cloud-based AI for live reading, but as a privacy professional (currently studying for the CIPP/E), I made a deliberate pivot.

Professional editors and authors handle sensitive, unreleased intellectual property. I chose to rebuild for **100% Local Privacy** so that no manuscript data ever touches a cloud for AI training.

- **Transcription**: Powered by Moonshine STT (on-device). 
- **Narration**: Powered by Kokoro TTS.
- **Design**: Inspired by the tactile parameters of my ten year old OP-1 portable field synthesizer by Teenage Engineering and [Penny Magazine](https://www.pennyzine.co). With OpenDyslexic support special thanks to abbiegonzalez.com.

## Notes / contact

Created by Kate Thomas at Sixpenny & Co.

Email thoughts, issues, ideas to: kate at sixpenny.org
