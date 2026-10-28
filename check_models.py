
from dotenv import load_dotenv
from google import genai
import os

load_dotenv()

api_key = os.getenv("OPEN_API_KEY")

if not api_key:
    raise ValueError("OPEN_API_KEY not found in .env file")

client = genai.Client(api_key=api_key)

print("\nModels supporting text generation:\n")

for model in client.models.list():
    supported_actions = model.supported_actions or []

    if "generateContent" in supported_actions:
        print(model.name)
