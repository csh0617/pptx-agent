# PPTX Agent Server

Claude API ê¸°ë° ê³ íì§ PowerPoint ìë ìì± ìë².

## ìí¤íì²

```
Readdy AI íë¡ í¸ìë
       â
       â POST /api/generate-pptx { topic: "..." }
       â¼
pptx-agent (Node.js ìë²)
       â
       ââââ Claude API (Tool Use)
       â       âââ bash ëêµ¬ë¡ pptxgenjs ì½ë ì¤í
       â
       ââââ Supabase Storage
               âââ .pptx íì¼ ìë¡ë â ê³µê° URL ë°í
```

## ë¹ ë¥¸ ìì

### 1. íê²½ë³ì ì¤ì 
```bash
cp .env.example .env
# .env íì¼ì API í¤ ìë ¥
```

### 2. Supabase Storage ë²í· ìì±
Supabase Dashboard â Storage â New Bucket
- Name: `pptx-files`
- Public: â (íì¼ ë¤ì´ë¡ë ê°ë¥íê²)

### 3. ë¡ì»¬ ì¤í
```bash
npm install
npm start
```

### 4. íì¤í¸
```bash
curl -X POST http://localhost:3000/api/generate-pptx \
  -H "Content-Type: application/json" \
  -d '{"topic": "ë¯¸ëì°¨ì ì ê¸°ì°¨ í¸ë ë ì¬ë¼ì´ë 10ì¥"}'
```

ìëµ:
```json
{
  "success": true,
  "jobId": "550e8400-...",
  "url": "https://your-project.supabase.co/storage/v1/object/public/pptx-files/550e8400-.../presentation.pptx",
  "filename": "presentation.pptx"
}
```

## ë°°í¬ (Railway ê¶ì¥)

```bash
# Railway CLI
railway login
railway init
railway up

# íê²½ë³ì ì¤ì 
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set SUPABASE_URL=https://...
railway variables set SUPABASE_SERVICE_KEY=eyJ...
```

ëë **Render**, **Fly.io**, **Google Cloud Run**ìë ëì¼íê² ë°°í¬ ê°ë¥.

## Readdy AIìì í¸ì¶íë ë°©ë²

Readdy AIã°ì HTTP Request ë¸ë¡ì ì¬ì©:

```
Method: POST
URL: https://your-server.railway.app/api/generate-pptx
Headers: Content-Type: application/json
Body: { "topic": "{{user_input}}" }
```

ìëµì `url` ê°ì ë²í¼ ë§í¬ë iframeì ì°ê²°íë©´ ì¦ì ë¤ì´ë¡ëë©ëë¤.

## API ëªì¸

### POST /api/generate-pptx

**Request Body**
```json
{ "topic": "ì¬ë¼ì´ë ì£¼ì  (ìì  íì)" }
```

**Response (200)**
```json
{
  "success": true,
  "jobId": "uuid",
  "url": "https://...supabase.co/.../presentation.pptx",
  "filename": "presentation.pptx"
}
```

**Response (500)**
```json
{ "success": false, "error": "ì¤ë¥ ë©ìì§" }
```

### GET /health
ìë² ìí íì¸. `{ "status": "ok" }` ë°í.

## ë¹ì© ì¶ì 

ì¬ë¼ì´ë 1ê° ì¸í¸(10ì¥) ê¸°ì¤:
- Claude Sonnet: ì½ $0.05~0.10
- Claude Opus: ì½ $0.30~0.60
- ìì± ìê°: 30~90ì´

## íì¼ êµ¬ì¡°

```
pptx-agent/
âââ server.js        # Express HTTP ìë²
âââ agent.js         # Claude API ìì´ì í¸ ë£¨í
âââ system-prompt.js # pptxgenjs ëìì¸ ê°ì´ë (íµì¬ ì¤í¬)
âââ package.json
âââ Dockerfile
âââ .env.example
âââ README.md
```
