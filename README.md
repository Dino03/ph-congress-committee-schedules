# PH Congress Committee Schedules

This repository collects committee hearing schedules from the Philippine Congress and
publishes them as a searchable calendar web experience.

## Project structure

- `scripts/` – Playwright/Node scripts that download committee schedules and
  transform them into structured JSON.
- `docs/data/` – Generated JSON data files used by both the scraper and the web
  interface.
- `src/` – Next.js 15 application that renders the public calendar UI.

## Getting started

```bash
# Install dependencies
npm install

# Fetch the latest raw data (writes into output/)
npm run fetch

# Build cleaned JSON for the web application (writes into docs/data/)
npm run build:data

# Run the web application locally
npm run web:dev
```

## Deploying the static site

The Next.js app is configured for static export. To refresh the `docs/` folder
(which can be served via GitHub Pages), run:

```bash
npm run web:build
```

This command builds the Next.js app, exports static HTML, and copies the output
into `docs/` while keeping the generated `docs/data/` files intact.
