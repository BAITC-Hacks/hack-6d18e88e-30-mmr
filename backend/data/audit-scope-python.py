import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.ai_scope import ensure_ai_scope, ScopeViolation

for draft in ['В кафе каждый вечер списываем выпечку. Хотим предсказывать, сколько печь завтра', 'Нужна электронная очередь к врачу']:
    try:
        ensure_ai_scope(draft, 'Retail')
        result = 'allowed'
    except ScopeViolation as error:
        result = error.code
    print(json.dumps({'draft': draft, 'result': result}, ensure_ascii=False))
