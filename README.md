# MailMind — RAG-Powered AI Email Assistant

> Intelligent personal email intelligence, semantic search, and human-in-the-loop drafting powered by **Retrieval-Augmented Generation (RAG)**, **LangGraph**, and **Google Gemini**.

---

## 🌟 Overview

**MailMind** is a full-stack personal AI copilot designed to transform how you interact with your email inbox. Instead of wading through hundreds of unread messages and complex threads, MailMind indexes your emails locally, performs fast semantic vector search, and uses self-reflective LangGraph agent workflows to answer questions, cite exact email sources, and synthesize contextual draft replies for your review.

---

## 🚀 Key Features

- 🔐 **Secure Google OAuth 2.0 Integration**  
  Authenticate directly with your Gmail account using official Google OAuth2. Tokens and emails remain strictly on your local machine.

- ⚡ **768-Dimensional Local Embeddings (ONNX)**  
  Powered by `BAAI/bge-base-en-v1.5` running locally via ONNX Runtime and Hugging Face tokenizers. Delivers top-tier retrieval performance without heavy GPU or PyTorch binary requirements.

- 🗄️ **Persistent ChromaDB Vector Store**  
  Stores thread-aware email chunks with rich metadata (`subject`, `sender`, `date_sent`, `thread_id`) for sub-second similarity search.

- 🧠 **Self-Checking LangGraph Workflow**  
  Implements an agentic loop:
  1. **Retrieve**: Pulls relevant email snippets based on natural language queries.
  2. **Generate**: Synthesizes a grounded answer using Google Gemini.
  3. **Self-Check**: Evaluates groundedness to eliminate hallucinations.
  4. **Rewrite & Retry**: Automatically refines queries if initial retrieval is insufficient.

- ✍️ **Human-in-the-Loop Draft Replies**  
  Drafts professional, context-rich responses tailored to entire email conversations while keeping you in full control — drafts always require explicit user approval.

- 🎨 **Modern Glassmorphic React UI**  
  Sleek dark-mode dashboard built with React 19 and Vite, featuring live connection badges, expandable citations, and one-click thread syncing.

---

## 🏗️ Architecture

```
MailMind/
├── client/                 # React 19 + Vite Frontend (Port 3000)
│   ├── src/
│   │   ├── App.jsx         # Main application container
│   │   ├── Navbar.jsx      # Header with OAuth status & email selector
│   │   ├── QueryView.jsx   # Natural language Q&A with source citations
│   │   ├── DraftView.jsx   # Context-aware email drafter & approval flow
│   │   ├── SyncPanel.jsx   # Gmail inbox fetch & vector indexing controls
│   │   └── api.js          # Unified API client
│   └── vite.config.js
│
├── server/                 # Node.js + Express Backend (Port 4000)
│   ├── src/
│   │   ├── index.js        # Express server entrypoint
│   │   ├── db.js           # SQLite storage (sql.js) for emails & tokens
│   │   ├── auth/google.js  # Google OAuth2 client & token refresh
│   │   ├── routes/auth.js  # /auth/login, /auth/callback, /auth/status
│   │   ├── routes/email.js # /ingest, /query, /draft, /threads
│   │   └── services/       # Gmail API ingestion
│   └── package.json
│
└── agent/                  # Python FastAPI Agent Service (Port 8000)
    ├── main.py             # FastAPI entrypoint (/health, /ingest, /query, /draft)
    ├── src/
    │   ├── graph.py        # LangGraph cyclic retrieval & self-check workflow
    │   ├── embedder.py     # 768-dim BGE ONNX embeddings & ChromaDB store
    │   ├── chunker.py      # Thread-aware document chunking
    │   ├── drafter.py      # Human-in-the-loop reply synthesis
    │   ├── llm.py          # Google Gemini / OpenAI model factory
    │   ├── db.py           # SQLite bridge
    │   └── retriever.py    # Vector store query interface
    └── requirements.txt
```

---

## 🛠️ Tech Stack

| Tier | Technologies |
|---|---|
| **Frontend** | React 19, Vite, Modern CSS (Glassmorphism), React Markdown |
| **Backend API** | Node.js, Express, `googleapis`, `sql.js` (WASM SQLite), Morgan, CORS |
| **Agent / AI Engine** | Python 3.11+, FastAPI, Uvicorn, LangGraph, LangChain, Google GenAI SDK |
| **Vector Database** | ChromaDB (persistent local SQLite + HNSW index) |
| **Embeddings** | `BAAI/bge-base-en-v1.5` via ONNX Runtime & Tokenizers (768 dimensions) |
| **Language Model** | Google Gemini 2.0 / 2.5 Flash (via free Google AI Studio key) |

---

## 🚦 Getting Started

### Prerequisites

- **Node.js**: `v18+` (recommended: `v20+`)
- **Python**: `3.11+`
- **Google Cloud Console**: An active project with **Gmail API** enabled.
- **Google AI Studio Key**: Free API key from [aistudio.google.com](https://aistudio.google.com/app/apikey).

---

### 1. Clone the Repository

```bash
git clone https://github.com/abhi-1289-9821/MailMind.git
cd MailMind
```

---

### 2. Configure Google Cloud OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **Gmail API** and **Google People API**.
3. Create OAuth 2.0 Credentials:
   - Application Type: **Web application**
   - Authorised Redirect URI: `http://localhost:4000/auth/callback`
4. Under **OAuth consent screen**, add your Gmail address to the **Test Users** list.

---

### 3. Setup the Node.js Backend (`server`)

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/callback
GMAIL_FETCH_LIMIT=200
PORT=4000
AGENT_SERVICE_URL=http://localhost:8000
```

Start the backend:
```bash
npm run dev
```

---

### 4. Setup the Python Agent Service (`agent`)

```bash
cd ../agent
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Linux / macOS:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Edit `agent/.env`:

```env
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.0-flash
SQLITE_DB_PATH=../server/data/gemai.db
CHROMA_DB_PATH=./chroma_db
CHROMA_COLLECTION=gemai_emails
PORT=8000
```

Start the agent:
```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

---

### 5. Setup the React Frontend (`client`)

```bash
cd ../client
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser!

---

## 📖 User Workflow

1. **Link Gmail**: Enter your Gmail address in the top bar and click **Connect Gmail**. Approve read permissions via Google's OAuth consent screen.
2. **Sync Inbox**: Under **Sync Emails**, click **Fetch & Index Emails** to pull your latest emails into local SQLite and generate 768-dim vector embeddings in ChromaDB.
3. **Ask Questions**: Switch to the **Ask Inbox** tab. Type queries such as *"What did the team decide about Q3 goals?"* or *"Any interview feedback from Google?"*. The LangGraph agent retrieves documents, checks for groundedness, and outputs an answer with cited emails.
4. **Draft Responses**: Select a thread under **Draft Reply**, describe your intent (*e.g., "Politely decline and suggest syncing next month"*), and MailMind will synthesize a context-aware email draft for your one-click approval.

---

## 🔒 Security & Privacy

- **Zero Cloud Storage**: All fetched emails, vector embeddings, and SQLite databases remain strictly local on your machine.
- **Human Approval**: The system will never send an email automatically. All generated drafts are marked `pending_approval` until explicitly reviewed and confirmed.
- **Credentials Protected**: Client secrets, tokens, and database files are strictly ignored by `.gitignore`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
