"""
database.py - Connexion MongoDB pour stocker les conversations et les sources RAG
utilise le Motor (driver async pour MongoDB) compatible avec FastAPI.

Collections :
 -conversation :{_id, title, created_at, updated_at, model}
 -message :{_id, conversation_id, role, content, created_at, sources}

"""
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
from motor import motor_asyncio
from backend.config import get_settings


class MongoDB:
    def __init__(self):
        self.client = None
        self._db = None
       
    async def connect(self) -> None:
        s = get_settings()
        try:
            self.client = motor_asyncio.AsyncIOMotorClient(s.mongodb_uri,serverSelectionTimeoutMS=5000)
            await self.client.admin.command('ping')  # Vérifie la connexion
            self._db = self.client[s.mongodb_db]
            
            #create indexes
            await self._db.conversations.create_index("created_at")
            await self._db.messages.create_index("conversation_id")
            await self._db.messages.create_index("created_at") 
            print(f"✅ Connecté à MongoDB: {s.mongodb_uri}, DB: {s.mongodb_db}")  
        except Exception as e:
            print(f"❌ MongoDB inacessible: {e}")
            print(" Le chatbot fonctionnera sans persistance")
            self._client = None
            self._db = None
            
    async def disconnect(self) -> None:
        if self.client:
            self.client.close()
            print("🛑 Déconnecté de MongoDB")
    
    def _check(self):
        if self._db is None:
            raise RuntimeError("MongoDB n'est pas connecté. Assurez-vous d'appeler connect() avant d'utiliser la base de données.") 
            
#-----Conversations et messages -----#
    async def create_conversation(self, title: str, model: str, provider: str ="OLLAMA") -> str:
        """Crée une nouvelle conversation et retourne son ID."""
        doc = {
            "title": title [:80],
            "model": model,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        result = await self._db.conversations.insert_one(doc)
        return str(result.inserted_id)
    
    async def list_conversations(self, limit: int = 50) -> list[dict]:
        """ Retourne la liste des dernières conversations (plus récentes en premier)."""
        cursor = self._db.conversations.find({},{ "title": 1, "model": 1, "created_at":1, "updated_at": 1}).sort("updated_at", -1).limit(limit)
        conversations = []
        async for conv in cursor:
            conversations.append({
                "id": str(conv["_id"]),
                "title": conv.get("title", "conversation"),
                "model": conv.get("model", "Ollama"), 
                "created_at": conv["created_at"].isoformat(),
                "updated_at": conv["updated_at"].isoformat(),
            })
        return conversations
    
    async def get_conversation(self, conversation_id: str) -> Optional[dict]:
        """Retoune une conversation par son ID"""
        self._check()   
        try: 
            doc = await self._db.conversations.find_one({"_id": ObjectId(conversation_id)})
        except Exception:
            return None
        if not doc:
            return None
        return{
            "id":     str(doc["_id"]),
            "title":  doc.get("title", "conversation"),
            "model":  doc.get("model", "Ollama"),
            "created_at": doc["created_at"].isoformat(),
            "updated":    doc["updated_at"].isoformat(),
        }
    async def delete_conversation(self, conversation_id: str) -> bool:
        self._check()
        try: 
            old = ObjectId(conversation_id)
        except Exception:
            return False
        await self._db.messages.delete_many({"conversation_id": conversation_id})
        result = await self._db.conversations.delete_one({"_id": old})
        return result.deleted_count > 0

    async def update_conversation_title(self, conversation_id: str, title: str) -> None:
        """Met à jour le titre et la date de modification"""
        self._check()
        try:
            await self._db.conversations.update_one({"id": ObjectId(conversation_id)},
                                                   {"$set": {"title": title[:80], "updated_at": datetime.now(timezone.utc)}},)
        except Exception:
            pass
                
    async def add_message(self, conversation_id: str, role: str, content: str, sources: list[list] | None = None):
        """Ajoute un message à une conversation existante."""
        self._check()
        doc = {
            "conversation_id": ObjectId(conversation_id),
            "role": role,
            "content": content,
            "sources": sources or [],
            "created_at": datetime.now(timezone.utc),
        }
        result = await self._db.messages.insert_one(doc)
        await self._db.conversations.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {"updated_at": datetime.now(timezone.utc)}}
        )
        return str(result.inserted_id)
    
    async def get_messages(self, conversation_id: str) -> list[dict]:
        """Retourne les messages d'une conversation, triés par date de création."""
        self._check()
        cursor = self._db.messages.find({"conversation_id": conversation_id}).sort("created_at", 1)
        messages = []
        async for msg in cursor:
            messages.append({
                "id": str(msg["_id"]),
                "role": msg["role"],
                "content": msg["content"],
                "sources": msg.get("sources", []),
                "created_at": msg["created_at"].isoformat(),
            })
        return messages
    
    @property
    def is_connected(self) -> bool:
        return self._db is not None

    
db = MongoDB()