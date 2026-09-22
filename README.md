# Scripture Study Ultimate V3.2

An offline-first Progressive Web App for Bible reading and Biblical studies.

## Main features

- 66-book Bible navigation
- Reader and three-column Parallel Bible mode
- Berean Standard Bible study layer with English text linked to Strong's numbers
- Hebrew and Greek original-language display
- Verse morphology, topics, and cross references
- Strong's lexicon and concordance packs
- Bible atlas with searchable verse-linked places and journey presets
- Book background guides for all 66 books
- Offline translation packs and study packs stored in IndexedDB
- Notes, bookmarks, highlights, reading history, backup and restore
- Installable PWA for Android, iPhone, tablets, and desktop
- Local import for privately licensed Bible translations

## Translation availability

Open/public-domain translations are immediately usable. NLT, ESV, and Ang Bible: Pinoy Version are visible as license-required packs but are disabled in Reader and Parallel selectors until an authorized local JSON pack is imported.

The app does not redistribute the complete New Living Translation, English Standard Version, or Ang Bible: Pinoy Version.

## Hosting

This repository is connected to the Vercel project `scripture-study-ultimate`. Commits pushed to `main` can trigger production deployments through Vercel Git integration.

This is a static app and can also be hosted on another HTTPS static host. PWA installation requires HTTPS, except on localhost during development.
