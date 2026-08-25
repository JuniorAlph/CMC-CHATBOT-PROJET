# CMC-chatbot — FastAPI

Backend FastAPI + frontend HTML/JS/CSS.  
Les différentes clés API reste côté serveur (jamais exposée au navigateur).

## Structure

```
CMC-CHATBOT-PROJET/
├── backend/
|   ├── .env
│   ├── main.py          ← Application FastAPI (routes, CORS, lifespan)
│   ├── CMCBOT.py      ← Client async DeepSeek (httpx, streaming SSE)
│   ├── models.py        ← Schémas Pydantic (validation)
│   ├── config.py        ← Configuration depuis .env
|   ├── Database.py   ← Gestion de la base de donnée
|   ├── metrics.py  ← Métriques d'évaluation du chatbot
│   └── requirements.txt ← Dépendances 
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js       ← Appels vers notre FastAPI
│       ├── ui.js        ← Manipulation DOM
│       |__ dashboard.js ← Affichage du dashboard
|      └── app.js       ← Orchestration    
└── Readme.md
```

## Installation

```bash
# 1. Créer et activer un environnement virtuel
python -m venv venv
source venv/bin/activate        # Linux/macOS
venv\Scripts\activate           # Windows

# 2. Installer les dépendances
cd backend
pip install -r requirements.txt

# 3. Configurer la clé API
cp ../.env
# Éditez .env et ajoutez votre clé qwen et AnythingLLM
```

## Démarrage

```bash
cd backend
uvicorn main:app --reload --port 8000
ou directement python -m backend.main:app --reload --port 8000
```

L'app est accessible sur **http://localhost:8000**

- Interface chat : http://localhost:8000
- Documentation API (Swagger) : http://localhost:8000/docs
- Documentation API (ReDoc) : http://localhost:8000/redoc

## Endpoints API

| Méthode | Route                                      | Description                                                    |
|---------|--------------------------------------------|----------------------------------------------------------------|
| GET     | `/health`                                  | Statut du serveur + clé API                                    |
| GET     | `/rag/status`                              | RAG géré par AnythingLLM                                       |
| POST    | `/rag/reindex`                             | Avec AnythingLLM,la réindexation se fait via son interface web |
| GET     | `/models`                                  | Modèles disponibles                                            |
| GET     | `/metrics`                                 | Résumé des métriques de performance  du chatbot                | 
| GET     | `/metrics/history`                         | Historique des N dernières métriques individuelles             | 
| GET     | `/conversation`                            | Sauvegarde de l'historique des conversations                   |
| GET     | `/conversation/{conversation_id}/messages` | Resumé des conversations                                       |
| DELETE  | `/conversation/{conversation_id}`          | Suppression de l'historique des conversation                   |
| POST    | `/chat`                                    | Réponse complète                                               |
| POST    | `/chat/stream`                             | Streaming SSE (tokens en temps réel)                           |

