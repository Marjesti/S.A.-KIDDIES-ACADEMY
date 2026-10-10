S.A. KIDDIES ACADEMY SRMS V17 — CLEAN GITHUB PAGES PACKAGE

This ZIP is only the website frontend. Upload the CONTENTS of this folder to the root of your existing GitHub Pages publishing source. Do not upload the enclosing folder itself.

The index.html file is at the root, along with css/, js/, assets/, and the other HTML pages. SQL files are intentionally excluded because GitHub Pages serves static files and does not execute database SQL.

IMPORTANT: Keep your existing js/config.js Supabase URL and publishable/anon key if they differ. Never put a Supabase service_role key in frontend files.

The SQL migration is supplied separately. Run it only in the Supabase SQL Editor, not on GitHub. Back up your database and review its duplicate-check output before applying the unique index.
