FROM python:3.12-slim

WORKDIR /app

# Install system deps for cryptography / audio libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Writable dirs for runtime data
RUN mkdir -p uploads canvas-pages

EXPOSE 5001

CMD ["python3", "server.py"]
