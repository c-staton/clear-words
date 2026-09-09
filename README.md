# Clear Words

This app turns a thought into clear words you can paste into any AI chat.

## Run

```bash
npm install
npm start
```

Open http://localhost:8787

## Use

1. Pick **I wrote something** or **I need help starting**.
2. Paste what you have or pick what you are working on.
3. Answer a few short questions.
4. Copy the prompt and paste it wherever you want.

The app starts in the browser, then sends answers to `/api/session/answer`. `/api/session/start` is kept as a backup.

Add `OPENROUTER_API_KEY` to `.env`. You can also set `OPENROUTER_MODEL` and `PORT`.

Do not commit secrets.
