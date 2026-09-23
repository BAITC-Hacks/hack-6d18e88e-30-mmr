from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.ai_routes import router as ai_router

app = FastAPI(
    title="AI Sana TaskRank API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_router, prefix="/api")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ai-sana-taskrank",
    }
