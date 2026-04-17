# Project Goal (Panda)

An AI-powered goal tracking and community platform. Users speak their goals; Gemini AI structures them and matches users with similar goals into community groups.

## Architecture

- **Frontend**: React 19 + TypeScript, Tailwind CSS v4, Vite
- **Backend**: Express.js server (`server.ts`) serving both API and React frontend
- **Database**: Firebase Firestore (database ID: `ai-studio-a88ce025-f109-4cce-bf43-4c096c19e5dd`)
- **AI**: Google Gemini (`@google/genai`) for transcription, goal structuring, and embeddings
- **Chat**: Stream Chat for community messaging
- **Auth**: Google OAuth via Firebase

## Project Structure

```
/
├── server.ts           # Express server (API + Vite middleware)
├── server/
│   └── gemini.ts       # Gemini AI helpers (transcription, embeddings, goal generation)
├── src/
│   ├── App.tsx         # Root React component
│   ├── main.tsx        # React entry point
│   ├── components/     # UI screens and components
│   ├── contexts/       # React Context providers (e.g., LanguageContext)
│   ├── hooks/          # Custom React hooks
│   ├── services/       # Frontend API service calls
│   ├── lib/            # Utilities and translations
│   └── types.ts        # Shared TypeScript types
├── vite.config.ts      # Vite config (allowedHosts: true, host: 0.0.0.0)
├── firebase-applet-config.json  # Firebase project config
└── firestore.rules     # Firestore security rules
```

## Running the App

The app runs on port 5000 via `PORT=5000 npm run dev`.

- In dev mode: Express + Vite middleware (HMR enabled)
- In production: Express serves the built `dist/` folder

## Required Environment Variables

- `gemfree` or `GEMINI_API_KEY` — Gemini API key for AI features
- `FIREBASE_SERVICE_ACCOUNT` — Firebase Admin SDK service account JSON
- `SESSION_SECRET` — Express session secret
- `STREAM_API_KEY` — Stream Chat API key
- `STREAM_API_SECRET` — Stream Chat API secret
- `APP_URL` — Public URL of the app

## Key Features

1. **Voice-to-Goal**: Record audio → transcribe → AI extracts structured goal
2. **Semantic Matching**: Gemini embeddings + cosine similarity to group similar goals
3. **Community Groups**: Real-time chat within AI-curated goal groups
4. **Multi-language Support**: Translation system via LanguageContext
5. **Home Screen Edit Mode**: Long-press (1.2s) any editable element to enter edit mode:
   - Bottom nav buttons swappable via dnd-kit (3 fixed slots)
   - Voice/text input widget draggable via react-rnd (bounded, no resize)
   - Goal cards draggable + resizable via react-rnd (individual per card)
   - Subtle jiggle animation (framer-motion) on all editable items in edit mode
   - Gold "Done" + "Reset layout" floating buttons to save/restore
   - Layout persisted to localStorage keyed by `layout_<userId>`

## New Files (Edit Mode)

- `src/lib/homeLayout.ts` — Layout types, localStorage helpers, defaults
- `src/hooks/useLongPress.ts` — 1.2s long-press hook (pointer-based, cancel on move >8px)
- `src/contexts/HomeEditModeContext.tsx` — Edit mode state + layout persistence provider
- `src/components/PandaIcon.tsx` — Extracted Panda icon (was inline in App.tsx)
- `src/components/SortableNavConsole.tsx` — dnd-kit sortable bottom nav
- `src/components/DraggableInputWidget.tsx` — react-rnd draggable input tile
- `src/components/EditableGoalCards.tsx` — Carousel (normal) / canvas (edit) goal cards
