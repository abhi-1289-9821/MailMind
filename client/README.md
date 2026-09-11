# MailMind — Frontend Web Client

The React 19 + Vite frontend application for **MailMind — RAG-Powered AI Email Assistant**.

## Features

- **OAuth Status Bar**: Displays server health, connection status, and direct Gmail OAuth authorization flow.
- **Sync Panel**: Trigger Gmail email fetching and vector embeddings ingestion.
- **Ask Inbox**: Conversational query panel with formatted answers and cited email source cards (sender, subject, timestamp, thread ID).
- **Draft Reply**: Contextual reply generator with tone customization and human-in-the-loop review/approval before sending.

## Development

```bash
# Install dependencies
npm install

# Run local development server (port 3000)
npm run dev

# Production build
npm run build
```
