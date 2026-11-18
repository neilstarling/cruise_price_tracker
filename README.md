# Cunard Queens Grill Tracker

A static, offline-capable PWA for saving and comparing Cunard Queens Grill cruise listings. Cruise details are extracted from screenshots with Gemini 2.5 Flash; your saved cruises and API key stay in browser storage unless you export them.

## Run locally

Serve this folder over `localhost` (for example, `python -m http.server 8000`) and open `http://localhost:8000`. A local HTTP server is needed for service workers; opening `index.html` directly does not enable PWA or offline support.

## Add a Gemini API key

1. Create a Gemini API key in Google AI Studio.
2. Open **Settings** in the tracker, paste the key and choose **Save key**.
3. Use **Add cruise screenshot**, drag and drop images, paste a clipboard image, or share an image to the installed PWA.

The key is stored in this browser's `localStorage` and sent directly to Google's Gemini API when processing an image. It is not protected from other people who can access your browser profile. Use a key with appropriate restrictions and review Google's API and data policies before uploading screenshots.

Screenshot extraction requires an internet connection and a valid API key. Previously saved cruises remain available offline. An extracted cruise opens in an editor so you can check or correct the details before saving.

## Deploy to GitHub Pages

1. Add these files to a GitHub repository.
2. In **Settings → Pages**, choose **Deploy from a branch**, select the branch and repository root (or the folder containing these files), then save.
3. Open the published HTTPS site. Install it from your browser's install option; Android users can also share listing screenshots to the installed app.

## Back up or move your data

Use **Export JSON** to download `cunard-cruises-backup.json`. **Import JSON** accepts that file (or a JSON array of cruise records) and can merge it with or replace the current collection. Merging updates matching cruise numbers and departure dates instead of creating duplicates.

The app stores cruise data and the API key in this browser's `localStorage`; they are not automatically synchronized to GitHub. Review exported files before committing them, especially if they contain personal information.
