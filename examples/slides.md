---
# Minimal Slidev frontmatter for using slidev-sync-cloudflare.
#
# 1. Install the client addon: `npm i slidev-addon-sync`
# 2. Deploy this server (see README — click the "Deploy to Cloudflare" button).
# 3. Replace the server URL below with your *.workers.dev address.
# 4. Build your deck, click the "connect" icon in Slidev's nav, type a long
#    random room hash, share that hash with any tab/device you want synced.
title: My Synced Slidev Deck
addons:
  - slidev-addon-sync
syncSettings:
  server: wss://your-deploy-name.your-account.workers.dev
  # Optional: auto-reconnect for N seconds after page refresh.
  autoConnect: 86400  # 1 day
---

# Slide One

This slide is normal markdown — the sync addon doesn't change how you write.

---

# Slide Two

Advance from any connected tab; the rest follow.

<!--
Speaker notes work as usual. View them at /#/notes or /#/presenter — both
follow the synced slide pointer thanks to the addon.
-->
