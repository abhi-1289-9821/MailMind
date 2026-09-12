## RAG Evaluation Benchmark Results

**Test Suite**: 10 Curated Queries across Real Inbox Data & Adversarial Negatives  
**Evaluation Date**: 2026-09-11 | **Model**: `gemini-2.0-flash` / `qwen/qwen3.8-27b`  

| ID | Category | Test Query | Sources | Grounded | Latency | Result |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| #1 | Specific Entity | What rejection emails have I received from companies? | 6 | ✅ Yes | 120.55s | ✅ PASS |
| #2 | Account Security | Did Autodesk send me any security or password notifications? | 3 | ✅ Yes | 335.82s | ✅ PASS |
| #3 | Dev Tools / Infra | What did Railway notify me about in my inbox? | 3 | ✅ Yes | 15.46s | ✅ PASS |
| #4 | Verification Code | Did Amazon send any verification codes or assessment invites? | 11 | ✅ Yes | 35.92s | ✅ PASS |
| #5 | Job Recommendations | What job alerts or openings were sent by Naukri? | 28 | ✅ Yes | 34.27s | ✅ PASS |
| #6 | Language / Learning | What progress update did Duolingo email me? | 7 | ✅ Yes | 54.94s | ✅ PASS |
| #7 | Adversarial Refusal | What did Elon Musk email me about Twitter / X? | 0 | ✅ Yes | 122.94s | ✅ PASS (Refused) |
| #8 | Adversarial Refusal | What is my flight confirmation code and hotel reservation for Tokyo? | 0 | ✅ Yes | 94.19s | ✅ PASS (Refused) |
| #9 | Adversarial Refusal | What did Sarah say about the Q3 marketing budget? | 0 | ✅ Yes | 122.51s | ✅ PASS (Refused) |
| #10 | AI / Product Updates | Did Google AI Studio send any updates about Gemini models? | 12 | ✅ Yes | 60.99s | ✅ PASS |

### Key Benchmark Metrics
- **Overall Accuracy**: **100.0%**
- **Hallucination Rate**: **0.0%** (strict self-check refusal on absent facts)
- **Refusal Precision**: **100%** (correctly caught 3/3 adversarial negative queries)
- **Average Query Latency**: **99.76s** (including 20-doc vector retrieval + groundedness verification)