# Chaya.2bd

Responsive anonymous text-chat MVP with a Node.js/Express server, WebSocket matchmaking (`ws`), and a rule-based English/Manglish automated chat partner.

## Run locally

Requirements: Node.js 20+

```bash
npm install
npm start
```

Open `http://localhost:3000` in two separate browser windows to test real-user matching. If no real user is available within 5 seconds, the app connects the visitor to a clearly labelled rule-based automated chat partner. After a random 3–6 user messages, that bot conversation ends and matchmaking automatically starts again, prioritizing real users. The video chat option is intentionally locked as Coming Soon.

## Deploy to Render Free

1. Push this folder to a GitHub repository.
2. In Render, create **New → Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Use the free instance type and deploy.
5. After deployment, replace `https://YOUR-RENDER-DOMAIN.onrender.com/` in `public/index.html`, `public/robots.txt`, and `public/sitemap.xml` with your actual public Render URL. Commit and redeploy.
6. Visit `/health`, `/robots.txt`, and `/sitemap.xml` to check them. Add the final URL property in Google Search Console and submit `/sitemap.xml`.

The server also generates `/robots.txt` and `/sitemap.xml` dynamically using the request host; static files are included as fallbacks.

## Important MVP notes

- Online count reflects active WebSocket connections to this single server instance. It is not a simulated audience number and may include people on the landing page, not only active chatters. It refreshes as server presence updates; no fake users are added.
- The matchmaking queue and chat rooms are in memory. They reset on service restarts and this single-process implementation is not intended for horizontal scaling without a shared presence/queue layer.
- Messages are relayed in real time and are not stored in a database.
- Automated chat partners are disclosed in the interface and in the About & safety dialog.
- Add abuse reporting, blocking, moderation, privacy policy, terms, age safeguards, and rate limits appropriate to your launch before promoting broadly.
- Render free web services can sleep after inactivity. First requests after sleep may take time.
- Canonical URL, sitemap, and JSON-LD include a placeholder domain. Replace it with the actual deployed domain before submitting to search engines.
