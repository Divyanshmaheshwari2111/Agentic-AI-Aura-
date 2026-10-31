from flask import Flask, render_template, request, jsonify, send_file
from tavily import TavilyClient
from google import genai
from piper import PiperVoice
from vosk import Model, KaldiRecognizer
import requests
from google.genai.errors import ServerError
from dotenv import load_dotenv
import webbrowser
from urllib.parse import quote_plus
import time
import os
import re
import io
import wave
import json

load_dotenv()

app = Flask(__name__)

VOSK_MODEL_PATH = os.path.join(
    app.root_path,
    "vosk-model",
    "vosk-model-en-in-0.5"
)

vosk_model = None
PIPER_MODEL_PATH = os.path.join(
    app.root_path,
    "en_US-amy-medium.onnx"
)

_piper_voice = None


def get_piper_voice():
    global _piper_voice

    if _piper_voice is None:
        if not os.path.isfile(PIPER_MODEL_PATH):
            raise FileNotFoundError(
                f"Piper model not found: {PIPER_MODEL_PATH}"
            )

        _piper_voice = PiperVoice.load(PIPER_MODEL_PATH)

    return _piper_voice

api_key = os.getenv("OPEN_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

tavily_client = (
    TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
    if os.getenv("TAVILY_API_KEY")
    else None
)

def play_song(song):
    song = song.strip()

    if not song:
        return False

    url = (
        "https://www.youtube.com/results?search_query="
        + quote_plus(song)
    )

    return webbrowser.open(url)



def detect_weather_intent(message):
    text = message.lower().strip()

    weather_keywords = [
        "weather", "temperature", "forecast",
        "rain", "raining", "rainy", "rainfall",
        "umbrella", "hot", "cold", "sunny",
        "cloudy", "clouds", "wind", "windy",
        "humidity", "humid", "thunderstorm",
        "storm", "snow", "snowing", "heat",
        "hottest", "cooler"
    ]

    is_weather = any(
        re.search(r"\b" + re.escape(word) + r"\b", text)
        for word in weather_keywords
    )

    if not is_weather:
        return False, None

    # Remove common filler words from the beginning.
    text = re.sub(
        r"^(?:would|will|could|can|please|tell me|"
        r"aura|hey aura)\s+",
        "",
        text
    )

    # Match the city after "in", "for", or "at".
    city_match = re.search(
        r"\b(?:in|for|at)\s+"
        r"([a-zA-Z][a-zA-Z .'-]*?)"
        r"(?=\s+(?:there|will|would|be|it|today|"
        r"tomorrow|tonight|now|currently|right now|"
        r"this morning|this afternoon|this evening|"
        r"please|going to|later)\b|[?!,]|$)",
        text,
        re.IGNORECASE
    )

    if not city_match:
        return True, None

    city = city_match.group(1).strip(" .-'")

    if city.lower() in {
        "the", "here", "there", "my area",
        "my location", "outside"
    }:
        return True, None

    return True, city
    
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "")

    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Please enter a message."}), 400

    message = message.strip()

    # Detect weather questions before calling Gemini.
    
    # Detect natural-language weather requests.
    is_weather, city = detect_weather_intent(message)

    if is_weather:
        if not city:
            return jsonify({
                "reply": "Which city would you like the weather for?"
            })

        try:
            weather_response = requests.get(
                request.host_url.rstrip("/") + "/api/weather",
                params={"city": city},
                timeout=25
            )

            weather_data = weather_response.json()

            if not weather_response.ok:
                return jsonify({
                    "reply": weather_data.get(
                        "error", "Unable to fetch weather."
                    )
                })

            
            text = message.lower()

            rain_question = any(word in text for word in [
                "rain", "raining", "rainy", "rainfall",
                "umbrella", "precipitation"
            ])

            temperature_question = any(word in text for word in [
                "hot", "cold", "temperature", "warm",
                "cool", "hottest"
            ])

            if rain_question:
                rain_chance = weather_data.get("rain_chance")

                if rain_chance is None:
                    reply = (
                        f"I fetched the weather for {weather_data['city']}, "
                        "but the rain probability is unavailable."
                    )
                else:
                    reply = (
                        f"Rain forecast for {weather_data['city']}:\n\n"
                        f"Chance of precipitation today: {rain_chance}%.\n"
                        f"Current temperature: "
                        f"{weather_data['temperature']}°C.\n"
                        "This is today's forecast, not a guarantee "
                        "of rain at a specific time."
                    )

            elif temperature_question:
                reply = (
                    f"Current temperature in {weather_data['city']}: "
                    f"{weather_data['temperature']}°C.\n"
                    f"Feels like: {weather_data['feels_like']}°C.\n"
                    f"Today's high: {weather_data['max_temp']}°C.\n"
                    f"Today's low: {weather_data['min_temp']}°C."
                )

            else:
                reply = (
                    f"Current weather in {weather_data['city']}, "
                    f"{weather_data.get('country', '')}:\n\n"
                    f"Temperature: {weather_data['temperature']}°C\n"
                    f"Feels like: {weather_data['feels_like']}°C\n"
                    f"Humidity: {weather_data['humidity']}%\n"
                    f"Wind speed: {weather_data['wind_speed']} km/h\n"
                    f"Today's high: {weather_data['max_temp']}°C\n"
                    f"Today's low: {weather_data['min_temp']}°C"
                )

            return jsonify({"reply": reply})


        except (requests.RequestException, ValueError, KeyError):
            app.logger.exception("Chat weather lookup failed")
            return jsonify({
                "reply": "Sorry, I couldn't retrieve the weather right now."
            }), 502

    # Keep your existing Gemini functionality for other messages.
    if client is None:
        return jsonify({
            "error": "API key missing. Check your .env file."
        }), 500

    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=message
            )
            return jsonify({
                "reply": response.text or "No response generated."
            })

        except ServerError as error:
            if getattr(error, "code", None) != 503 or attempt == 1:
                raise
            time.sleep(1)


@app.route("/api/search", methods=["POST"])
def web_search():
    if tavily_client is None:
        return jsonify({
            "error": "TAVILY_API_KEY is missing from .env"
        }), 500

    data = request.get_json(silent=True) or {}
    query = data.get("query", "")

    if not isinstance(query, str) or not query.strip():
        return jsonify({"error": "Enter a search query."}), 400

    try:
        results = tavily_client.search(
            query=query.strip(),
            max_results=5,
            search_depth="basic"
        )

        return jsonify({
            "results": [
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", "")
                }
                for item in results.get("results", [])
            ]
        })

    except Exception:
        app.logger.exception("Tavily search failed")
        return jsonify({
            "error": "Web search failed. Check the Flask terminal."
        }), 502


@app.route("/api/news", methods=["GET"])
def get_news():
    api_key = os.getenv("GNEWS_API_KEY")

    if not api_key:
        return jsonify({
            "error": "GNEWS_API_KEY is missing from your .env file."
        }), 500

    category = request.args.get("category", "general").lower()

    allowed_categories = {
        "general", "world", "nation", "business",
        "technology", "entertainment", "sports",
        "science", "health"
    }

    if category not in allowed_categories:
        return jsonify({"error": "Invalid news category."}), 400

    try:
        response = requests.get(
            "https://gnews.io/api/v4/top-headlines",
            params={
                "category": category,
                "lang": "en",
                "country": "in",
                "max": 10
            },
            headers={"X-Api-Key": api_key},
            timeout=15
        )

        if not response.ok:
            app.logger.error(
                "GNews returned HTTP %s", response.status_code
            )
            return jsonify({
                "error": f"GNews request failed (HTTP {response.status_code})."
            }), 502

        data = response.json()

        articles = [
            {
                "title": article.get("title") or "Untitled",
                "description": article.get("description") or "",
                "url": article.get("url") or "",
                "image": article.get("image") or "",
                "publishedAt": article.get("publishedAt") or "",
                "source": (
                    article.get("source", {}).get("name") or "Unknown source"
                )
            }
            for article in data.get("articles", [])
        ]

        return jsonify({"articles": articles})

    except requests.RequestException:
        app.logger.exception("GNews connection failed")
        return jsonify({
            "error": "Could not connect to GNews. Check your internet connection."
        }), 502
    except ValueError:
        app.logger.exception("Invalid JSON received from GNews")
        return jsonify({"error": "GNews returned an invalid response."}), 502


@app.route("/api/weather", methods=["GET"])
def get_weather():
    city = request.args.get("city", "Bhopal").strip()

    if not city:
        return jsonify({"error": "Please enter a city."}), 400

    try:
        # Find the city's latitude and longitude.
        geo_response = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={
                "name": city,
                "count": 1,
                "language": "en",
                "format": "json"
            },
            timeout=10
        )
        geo_response.raise_for_status()
        locations = geo_response.json().get("results", [])

        if not locations:
            return jsonify({"error": "City not found."}), 404

        location = locations[0]

        # Get current weather and today's forecast.
        weather_response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "current": (
                    "temperature_2m,relative_humidity_2m,"
                    "apparent_temperature,is_day,precipitation,"
                    "weather_code,wind_speed_10m"
                ),
               "daily": (
    "temperature_2m_max,temperature_2m_min,"
    "precipitation_probability_max,weather_code"),
                "timezone": "auto"
            },
            timeout=10
        )
        weather_response.raise_for_status()

        weather = weather_response.json()
        current = weather.get("current", {})
        daily = weather.get("daily", {})

        return jsonify({
            "city": location["name"],
            "country": location.get("country", ""),
            "temperature": current.get("temperature_2m"),
            "feels_like": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "precipitation": current.get("precipitation"),
            "weather_code": current.get("weather_code"),
            "is_day": current.get("is_day"),
            "max_temp": daily.get("temperature_2m_max", [None])[0],
            "min_temp": daily.get("temperature_2m_min", [None])[0],
            "timezone": weather.get("timezone"),
            "rain_chance": daily.get("precipitation_probability_max", [None])[0],
            "daily_weather_code": daily.get("weather_code", [None])[0],
        })

    except requests.RequestException:
        app.logger.exception("Weather API request failed")
        return jsonify({
            "error": "Unable to fetch weather. Check your internet connection."
        }), 502

@app.route("/api/transcribe", methods=["POST"])
def transcribe_audio():
    global vosk_model

    audio_file = request.files.get("audio")

    if audio_file is None:
        return jsonify({"error": "No audio recording was received."}), 400

    try:
        # Load the model only when voice input is first used.
        if vosk_model is None:
            if not os.path.isdir(VOSK_MODEL_PATH):
                app.logger.error(
                    "Vosk model folder not found: %s",
                    VOSK_MODEL_PATH
                )
                return jsonify({
                    "error": "Vosk model folder not found. Check MODEL_PATH."
                }), 500

            vosk_model = Model(VOSK_MODEL_PATH)

        # The browser must send a 16 kHz, mono, 16-bit PCM WAV file.
        with wave.open(io.BytesIO(audio_file.read()), "rb") as wav:
            if (
                wav.getnchannels() != 1
                or wav.getsampwidth() != 2
                or wav.getframerate() != 16000
                or wav.getcomptype() != "NONE"
            ):
                return jsonify({
                    "error": "Audio format must be mono, 16-bit PCM, 16 kHz WAV."
                }), 400

            recognizer = KaldiRecognizer(vosk_model, 16000)

            while True:
                frames = wav.readframes(4000)
                if not frames:
                    break
                recognizer.AcceptWaveform(frames)

            result = json.loads(recognizer.FinalResult())

        text = result.get("text", "").strip()

        if not text:
            return jsonify({
                "error": "I couldn't recognize any speech. Please try again."
            }), 422

        return jsonify({"text": text})

    except wave.Error:
        return jsonify({
            "error": "The recording could not be read as a WAV file."
        }), 400

    except Exception:
        app.logger.exception("Vosk transcription failed")
        return jsonify({
            "error": "Speech recognition failed. Check the Flask terminal."
        }), 500

@app.route("/api/music", methods=["POST"])
def music():
    data = request.get_json(silent=True) or {}
    song = data.get("song", "")

    if not isinstance(song, str) or not song.strip():
        return jsonify({"error": "Please enter a song name."}), 400

    url = (
        "https://www.youtube.com/results?search_query="
        + quote_plus(song.strip())
    )

    return jsonify({
        "message": f"Searching for {song.strip()} on YouTube.",
        "url": url
    })

@app.route("/api/speak", methods=["POST"])
def speak_text():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")

    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Text is required."}), 400

    if len(text) > 100000:
        return jsonify({"error": "Text is too long."}), 400

    try:
        voice = get_piper_voice()
        audio_buffer = io.BytesIO()

        with wave.open(audio_buffer, "wb") as wav_file:
            voice.synthesize_wav(text.strip(), wav_file)

        audio_buffer.seek(0)

        return send_file(
            audio_buffer,
            mimetype="audio/wav",
            as_attachment=False,
            download_name="aura.wav"
        )

    except Exception:
        app.logger.exception("Piper text-to-speech failed")
        return jsonify({
            "error": "Speech generation failed. Check the Flask terminal."
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)