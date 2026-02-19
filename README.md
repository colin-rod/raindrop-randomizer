# Raindrop Randomizer

Raindrop Randomizer is a lightweight Vercel application that helps you discover a random Raindrop.io bookmark based on the collection and filters you choose. It exposes a small set of serverless API routes that proxy the official Raindrop REST API and serves a static HTML interface from the `public/` folder.

## Features

- Fetches your Raindrop.io collections and displays the saved item counts.
- Returns a single random bookmark from a chosen collection with optional filters for length, media type, tag, and date range.
- Provides quick statistics that show how many items match common filters (videos, saved in the last 7 or 30 days, etc.).
- Allows updating bookmark metadata or deleting the bookmark directly through the API routes.

## Prerequisites

- **Node.js 18+** (to match the runtime used by Vercel and `node-fetch@3`).
- A **Raindrop.io API token** with access to the collections you want to browse. You can create a personal access token from your Raindrop.io account settings.
- The **Vercel CLI** (`vercel`) if you want to run the project locally, because the provided `npm run dev`/`npm start` commands are wrappers around Vercel.

## Installation

```bash
npm install
```

## Configuration

The application looks for your Raindrop credentials in the `RAINDROP_TOKEN` environment variable. For local development you can create an `.env` file in the project root:

```bash
# .env
RAINDROP_TOKEN=your_raindrop_token
```

When deploying to Vercel, add the same variable in the project settings under **Environment Variables**.

## Running Locally

1. Make sure you have authenticated the Vercel CLI (`vercel login`).
2. Start the local dev server:
   ```bash
   npm run dev
   ```
   This runs `vercel dev`, which serves the static assets from `public/` and mounts the serverless API routes under `/api`.

If you only need to exercise the API endpoints without installing the global CLI, you can use `npx vercel dev` instead of `npm run dev`.

## API Routes

All API routes live inside the [`api/`](api) directory and forward requests to the Raindrop REST API using the configured token. Each route returns JSON responses and standard HTTP status codes on error.

| Route | Method | Description |
| --- | --- | --- |
| `/api/getCollections` | `GET` | Lists all Raindrop collections with their item counts. |
| `/api/getRandom` | `GET` | Returns a random bookmark from the specified collection. Supports optional filters such as `lengthFilter`, `typeFilter`, `tagFilter`, `dateFilter`, and custom `startDate`/`endDate`. |
| `/api/getFilterStats` | `GET` | Computes helper statistics (total items, videos, last 7/30 days) for the selected collection. |
| `/api/update` | `POST` | Updates bookmark metadata (title, tags, target collection). Expect a JSON body containing at least `id` and `title`. |
| `/api/delete` | `DELETE` | Deletes a bookmark by `id`. |

> **Note**
> All routes require the `RAINDROP_TOKEN` environment variable. If it is missing, they respond with `500` and an explanatory error payload.

## Frontend

The static UI lives in [`public/index.html`](public/index.html). It provides a single-page interface for picking collections, applying filters, and displaying the random bookmark returned from `/api/getRandom`.

## Deployment

The repository includes a [`vercel.json`](vercel.json) configuration file so it can be deployed directly to Vercel. After pushing your changes to a Git repository, run `vercel` to create a new project or `vercel --prod` to publish updates.

## Contributing

Feel free to open issues or submit pull requests that improve the UI, add additional filters, or extend the API proxy functionality. When contributing, please include clear descriptions of the change and any relevant testing steps.
