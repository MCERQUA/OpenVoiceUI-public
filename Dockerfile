FROM python:3.12-slim

WORKDIR /app

# System deps for cryptography, audio, and DeepFace/OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Writable dirs for runtime data
RUN mkdir -p uploads canvas-pages known_faces music generated_music

# Bind to all interfaces inside the container
ENV HOST=0.0.0.0

EXPOSE 5001

CMD ["python3", "server.py"]
