# Agentic AI Aura

A voice-enabled AI assistant built with Flask. It listens to your speech with Vosk, answers with Google Gemini, searches the web with Tavily, and speaks the reply with Piper.

[Add one or two sentences describing what Aura does and what makes it useful.]

## Features

- Speech-to-text with Vosk (offline)
- AI responses with Google Gemini
- Web search with Tavily
- Text-to-speech with Piper
- Browser-based interface built with Flask

## Project Structure

```
.
├── main.py              # Flask app and main logic
├── check_models.py      # Checks that the speech models are installed
├── build.sh             # Build script used for deployment
├── requirements.txt     # Python dependencies
├── templates/
│   └── index.html       # Web interface
└── static/
    ├── script.js
    └── style.css
```

## Requirements

- Python 3.11
- A Gemini API key
- A Tavily API key

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Divyanshmaheshwari2111/Agentic-AI-Aura-.git
cd Agentic-AI-Aura-
```

### 2. Create and activate a virtual environment

Windows (PowerShell):
```powershell
python -m venv .venv
.venv\Scripts\activate
```

macOS/Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Download the speech models

These models are not included in the repository because of their size.

**Vosk model (English-India):**
1. Download `vosk-model-en-in-0.5` from https://alphacephei.com/vosk/models
2. Extract it into a folder named `vosk-model/` in the project root, so the path is `vosk-model/vosk-model-en-in-0.5/`.

**Piper voice (en_US-amy-medium):**
1. Download `en_US-amy-medium.onnx` and `en_US-amy-medium.onnx.json` from https://huggingface.co/rhasspy/piper-voices (under `en/en_US/amy/medium/`).
2. Place both files in the project root.

Run `python check_models.py` to confirm the models are found.

### 5. Create the `.env` file

Create a file named `.env` in the project root. Do not commit it to Git.

```env
GEMINI_API_KEY=your_gemini_api_key
TAVILY_API_KEY=your_tavily_api_key
```

[Confirm these variable names match what main.py reads.]

Get keys from:
- Gemini: https://aistudio.google.com/app/apikey
- Tavily: https://tavily.com

### 6. Run the app

```bash
python main.py
```

Then open http://127.0.0.1:5000 in your browser. [Confirm the port.]

## Deployment

The app is set up for Render. The build script downloads the speech models during the build, so they don't need to be in the repository.

- **Build command:** `bash build.sh`
- **Start command:** `gunicorn main:app --bind 0.0.0.0:$PORT --timeout 120`
- **Environment variables:** `GEMINI_API_KEY`, `TAVILY_API_KEY`, `PYTHON_VERSION=3.11`

Enter the API keys in the hosting dashboard, not in the repository.

## Troubleshooting

- **Yellow underlines on imports in VS Code:** Select the `.venv` interpreter (`Ctrl+Shift+P` → Python: Select Interpreter).
- **`ModuleNotFoundError`:** Run `pip install -r requirements.txt` inside the activated virtual environment.
- **Model not found:** Check the folder names in step 4 match exactly.

## License

[Add a license, or delete this section.]