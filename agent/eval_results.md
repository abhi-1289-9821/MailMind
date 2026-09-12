## RAG Evaluation Benchmark Results

**Test Suite**: 10 Curated Queries across Real Inbox Data & Adversarial Negatives  
**Evaluation Date**: 2026-09-12 | **Model**: `gemini-2.0-flash` (with Groq/OpenRouter fallback)  

| ID | Category | Test Query | Sources | Grounded | Latency | Result |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| #1 | Specific Entity | What rejection emails have I received from companies? | 1 | ✅ Yes | 21.02s | ✅ PASS |
| #2 | Account Security | Did Autodesk send me any security or password notifications? | 3 | ✅ Yes | 20.94s | ✅ PASS |
| #3 | Dev Tools / Infra | What did Railway notify me about in my inbox? | 4 | ✅ Yes | 88.14s | ✅ PASS |
| #4 | Verification Code | Did Amazon send any verification codes or assessment invites? | 0 | ✅ Yes | 145.18s | ❌ FAIL |
| #5 | Job Recommendations | What job alerts or openings were sent by Naukri? | 26 | ✅ Yes | 24.44s | ✅ PASS |
| #6 | Language / Learning | What progress update did Duolingo email me? | 10 | ✅ Yes | 24.34s | ✅ PASS |
| #7 | Adversarial Refusal | What did Elon Musk email me about Twitter / X? | 0 | ✅ Yes | 121.21s | ✅ PASS (Refused) |
| #8 | Adversarial Refusal | What is my flight confirmation code and hotel reservation for Tokyo? | 0 | ✅ Yes | 87.51s | ✅ PASS (Refused) |
| #9 | Adversarial Refusal | What did Sarah say about the Q3 marketing budget? | 0 | ✅ Yes | 108.22s | ✅ PASS (Refused) |
| #10 | AI / Product Updates | Did Google AI Studio send any updates about Gemini models? | 17 | ✅ Yes | 58.84s | ✅ PASS |

### Key Benchmark Metrics
- **Overall Accuracy**: **90.0%**
- **Hallucination Rate**: **0.0%** (strict self-check refusal on absent facts)
- **Refusal Precision**: **100%** (correctly caught 3/3 adversarial negative queries)
- **Average Query Latency**: **69.98s** (including 20-doc vector retrieval + groundedness verification)